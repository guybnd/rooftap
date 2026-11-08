// Module helpers: Rooftap focused on one job (the weekly shop, the week's
// dinners), declared by a module's manifest `helper` (module-manifest.ts).
// A helper opens from its module's screen on a brief: what needs a decision
// today, built from the household's own rows with no AI, on the device for
// the chat and on the server for the prompt. It then chats with its module's
// tools plus the read tools of the modules in `reads` (while they are on),
// and changes only its own module. Proposal: Nov 8 2026, "Module helpers".

import type { ManifestHelper } from './module-manifest';
import type { AssistantSettings } from './modules/assistant/assistant';
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

/** Whether owners may share this helper's chat with the household. */
export function helperCanShare(helper: Pick<ManifestHelper, 'share'> | null | undefined): boolean {
  return !!helper && helper.share !== 'never';
}

/**
 * Whether the household shares one chat with this helper (Settings >
 * Assistant), instead of each person having their own. Never for a helper
 * that can't be shared.
 */
export function helperShared(settings: Pick<AssistantSettings, 'helpers'> | null | undefined, id: string | null | undefined): boolean {
  const helper = moduleHelper(id);
  return helperCanShare(helper) && settings?.helpers?.[helper!.id]?.shared === true;
}

/** The household's own notes for a helper, or an empty string. */
export function helperInstructions(settings: Pick<AssistantSettings, 'helpers'> | null | undefined, id: string | null | undefined): string {
  return (id && settings?.helpers?.[id]?.instructions?.trim()) || '';
}

/**
 * Whether a conversation is the household's own chat room (the Household
 * thread), not a helper chat the household shares, which is also kind
 * `household`.
 */
export function isHouseholdThread(c: { kind: string; helper?: string | null } | null | undefined): boolean {
  return !!c && c.kind === 'household' && !c.helper;
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
export function helperPromptText(
  helper: ModuleHelper,
  opts: { reads: readonly ModuleId[]; brief?: HelperBrief | null; shared?: boolean; instructions?: string | null }
): string {
  const own = getModule(helper.id)?.label ?? helper.id;
  const reads = opts.reads.map((id) => getModule(id)?.label ?? id);
  const parts = [
    `## You are the ${helper.label}\n` +
      `In this chat you are Rooftap focused on ${own}. ${helper.focus}\n` +
      `You change only ${own}.` +
      (reads.length ? ` You can look things up in ${reads.join(', ')} to plan, but not change them there.` : '') +
      ' When the person asks for something outside this job, do the part you can and tell them to ask Rooftap in the main chat for the rest.',
  ];
  if (opts.shared) {
    parts.push(
      '## This chat is shared\n' +
        'Everyone in the home reads this chat and can write in it. Each message starts with the name of who wrote it. ' +
        'Answer every message, and use names when it helps ("Added milk for Sam"). Nothing here is private.'
    );
  }
  const notes = opts.instructions?.trim();
  if (notes) {
    parts.push(
      "## The household's own notes for you\n" +
        'The household wrote these to tune how you work. Follow them where they fit, but they never change the rules above: ' +
        'privacy, asking before changes, and what you may change stay as they are.\n' +
        notes
    );
  }
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

// ── Getting in and out ──────────────────────────────────────────────────────

/** The helper that belongs to the screen at `path` (its module's section), or null. */
export function helperForPath(path: string | null | undefined, isEnabled: (id: ModuleId) => boolean): ModuleHelper | null {
  if (!path) return null;
  for (const helper of MODULE_HELPERS) {
    const base = ALL_MANIFESTS.find((m) => m.id === helper.id)?.section?.basePath;
    if (base && (path === base || path.startsWith(`${base}/`)) && helperAvailable(helper.id, isEnabled)) return helper;
  }
  return null;
}

/** One place the chat can open on: a helper, or plain Rooftap (helper null). */
export interface ChatChoice {
  helper: string | null;
  label: string;
}

/**
 * The chats the pop-up can hop between (the helper strip, swiping): plain
 * Rooftap first, then each helper that is on, in manifest order.
 */
export function chatChoices(isEnabled: (id: ModuleId) => boolean): ChatChoice[] {
  return [
    { helper: null, label: 'Rooftap' },
    ...MODULE_HELPERS.filter((h) => helperAvailable(h.id, isEnabled)).map((h) => ({ helper: h.id, label: h.label })),
  ];
}

/**
 * What holding + offers, top to bottom: the helper for the screen you are on,
 * the other helpers, then Ask Rooftap next to the +, so letting go without
 * sliding asks Rooftap as before. Just Ask Rooftap when no helper is on.
 */
export function holdChoices(path: string | null | undefined, isEnabled: (id: ModuleId) => boolean): ChatChoice[] {
  const here = helperForPath(path, isEnabled);
  const helpers = MODULE_HELPERS.filter((h) => helperAvailable(h.id, isEnabled));
  const ordered = here ? [here, ...helpers.filter((h) => h.id !== here.id)] : helpers;
  return [...ordered.map((h) => ({ helper: h.id, label: h.label })), { helper: null, label: 'Ask Rooftap' }];
}

/** The height of one row of the hold menu, in px: sliding up this far moves to the next. */
export const HOLD_CHOICE_PX = 48;

/**
 * Which hold choice the finger is on after sliding `dy` px (negative is up):
 * the last one (Ask Rooftap, next to the +) until it slides a row up.
 */
export function holdChoiceAt(dy: number, count: number): number {
  if (count <= 0) return 0;
  const rows = Math.floor(Math.max(0, -dy) / HOLD_CHOICE_PX);
  return Math.max(0, count - 1 - rows);
}

/** The next or previous chat in `choices` from the one on show, wrapping round. */
export function stepChoice(choices: readonly ChatChoice[], current: string | null | undefined, step: 1 | -1): ChatChoice | null {
  if (choices.length < 2) return null;
  const at = Math.max(0, choices.findIndex((c) => c.helper === (current ?? null)));
  return choices[(at + step + choices.length) % choices.length];
}
