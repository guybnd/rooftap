// Module helpers: Rooftap focused on one job (the weekly shop, the week's
// dinners), declared by a module's manifest `helper` (module-manifest.ts).
// A helper opens from its module's screen on a brief: what needs a decision
// today, built from the household's own rows with no AI, on the device for
// the chat and on the server for the prompt. It then chats with its module's
// tools plus the read tools of the modules in `reads` (while they are on),
// and changes only its own module. Proposal: Nov 8 2026, "Module helpers".

import type { ManifestHelper } from './module-manifest';
import { ALL_MANIFESTS } from './module-manifests';
import { getModule, type ModuleId } from './modules';

export interface ModuleHelper extends ManifestHelper {
  /** The module the helper belongs to; also the helper's id. */
  id: ModuleId;
}

/** Every module's helper, in manifest order. */
export const MODULE_HELPERS: readonly ModuleHelper[] = ALL_MANIFESTS.flatMap((m) =>
  m.helper ? [{ ...m.helper, id: m.id as ModuleId }] : []
);

/** The helper of `id`'s module, or null when it has none. */
export function moduleHelper(id: string | null | undefined): ModuleHelper | null {
  if (!id) return null;
  return MODULE_HELPERS.find((h) => h.id === id) ?? null;
}

/** Whether a helper can open: its module and the Assistant are on. */
export function helperAvailable(id: string | null | undefined, isEnabled: (id: ModuleId) => boolean): boolean {
  const helper = moduleHelper(id);
  return !!helper && isEnabled(helper.id) && isEnabled('assistant' as ModuleId);
}

/** The modules a helper may read from right now: its `reads` that are on. */
export function helperReads(helper: ModuleHelper, isEnabled: (id: ModuleId) => boolean): ModuleId[] {
  return (helper.reads ?? []).filter((id) => isEnabled(id as ModuleId)) as ModuleId[];
}

/**
 * Which tools a helper chat gets: every tool of its own module, the read
 * tools of the modules it reads, the `writesVia` tools that change its
 * module from another one, and tools that belong to no module (web lookup,
 * feedback). A short list keeps cheap models fast and on task. Callers have
 * already dropped tools of modules that are off.
 */
export function helperKeepsTool(
  helper: ModuleHelper,
  readable: readonly string[],
  tool: { name: string; module: string; lookup?: boolean; moduleless?: boolean }
): boolean {
  if (tool.moduleless) return true;
  if (tool.module === helper.id) return true;
  if (helper.writesVia?.includes(tool.name)) return true;
  return !!tool.lookup && readable.includes(tool.module);
}

// ── The brief ───────────────────────────────────────────────────────────────

/**
 * One row of a brief. `suggest` is something not there yet (a missing
 * ingredient): one tap adds it. `item` is an existing row of the helper's
 * module, with an optional action (`readd`: put it back on the list).
 */
export type BriefRow =
  | { kind: 'suggest'; key: string; title: string; meta?: string | null }
  | {
      kind: 'item';
      id: string;
      title: string;
      meta?: string | null;
      /** Short fact on the right ("7 days ago"). */
      trailing?: string | null;
      /** Draws the trailing fact as a warning (something going off). */
      warn?: boolean;
      action?: 'readd' | null;
    };

export interface BriefSection {
  id: string;
  title: string;
  rows: BriefRow[];
  /** The header link that acts on every row ("Add all"); null when rows are only to look at. */
  allLabel?: string | null;
}

export interface HelperBrief {
  /** The display line, e.g. "Ready for the shop". */
  title: string;
  /** One or two sentences: the counts that matter. */
  lede: string;
  sections: BriefSection[];
}

/** The brief as prompt text, so the model knows it without spending tool calls. */
export function briefPromptText(brief: HelperBrief): string {
  const lines = [`## Today's brief (the person sees it above the chat)`, `${brief.title}. ${brief.lede}`];
  for (const section of brief.sections) {
    if (section.rows.length === 0) continue;
    lines.push(`${section.title}:`);
    for (const row of section.rows) {
      const facts = [row.meta, row.kind === 'item' ? row.trailing : null].filter(Boolean).join(', ');
      lines.push(`- ${row.title}${facts ? ` (${facts})` : ''}${row.kind === 'item' ? ` [id ${row.id}]` : ''}`);
    }
  }
  return lines.join('\n');
}

/** The helper's section of the system prompt: who it is, its playbook, what it reads, and the brief. */
export function helperPromptText(helper: ModuleHelper, opts: { reads: readonly ModuleId[]; brief?: HelperBrief | null; shared?: boolean }): string {
  const own = getModule(helper.id)?.label ?? helper.id;
  const reads = opts.reads.map((id) => getModule(id)?.label ?? id);
  const parts = [
    `## You are the ${helper.label}\n` +
      `In this chat you are Rooftap focused on ${own}. ${helper.focus}\n` +
      `You change only ${own}.` +
      (reads.length ? ` You can look things up in ${reads.join(', ')} to plan, but not change them there.` : '') +
      ' When the person asks for something outside this job, do the part you can and tell them to ask Rooftap in the main chat for the rest.',
  ];
  if (opts.brief) parts.push(briefPromptText(opts.brief));
  return parts.join('\n\n');
}

/** How long after the last message the brief shows again: a chat picked up later starts from today's picture. */
export const BRIEF_AFTER_QUIET_MS = 3 * 60 * 60 * 1000;

/** Whether the chat shows the brief: no messages yet, or none for a few hours. */
export function showsBrief(lastMessageAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!lastMessageAt) return true;
  const at = Date.parse(lastMessageAt);
  return !Number.isFinite(at) || now - at >= BRIEF_AFTER_QUIET_MS;
}

/** How many rows of a brief ask for a decision, for the helper button's dot. */
export function briefCount(brief: HelperBrief | null | undefined): number {
  if (!brief) return 0;
  return brief.sections.reduce((n, s) => n + s.rows.filter((r) => r.kind === 'suggest' || r.action).length, 0);
}
