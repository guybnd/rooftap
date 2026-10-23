// Picking from a proposal: the card lists each change (and each entry of a
// change that adds a list, such as three gift ideas) with a tick, so the
// person can leave some out or fix an entry's name before saying yes. The apps build
// the rows from proposalChoices; the server applies what was kept with
// applyProposalPicks, so both read the same keys.
import type { AssistantScope } from './home-assistant';
import { describeProposal } from './assistant-api';

/** One row on the card. */
export interface ProposalChoice {
  /** `2` for the third change, `2.1` for the second entry of its list. */
  key: string;
  module: AssistantScope;
  /** For an entry of a list: the summary of the change it belongs to, shown once above its entries. */
  group: string | null;
  /** What the row shows: the change's summary, or the entry's own name. */
  label: string;
  /** The entry's name, which the person can edit; null for a whole change. */
  text: string | null;
}

/** A kept row, with the entry's new name when the person changed it. */
export interface ProposalPick {
  key: string;
  text?: string;
}

interface ProposalLike {
  tool: string;
  /** A module id or the Home Assistant scope; stored proposals keep it as a plain string. */
  module: string;
  args: Record<string, unknown>;
  summary?: string;
}

/** The argument that holds a list of named entries, when there are two or more of them. */
function entryList(args: Record<string, unknown>): { field: string; entries: Record<string, unknown>[] } | null {
  for (const [field, value] of Object.entries(args)) {
    if (!Array.isArray(value) || value.length < 2) continue;
    if (value.every((v) => v && typeof v === 'object' && typeof (v as { title?: unknown }).title === 'string')) {
      return { field, entries: value as Record<string, unknown>[] };
    }
  }
  return null;
}

/** The card's rows, in order. */
export function proposalChoices(items: ProposalLike[]): ProposalChoice[] {
  return items.flatMap((item, i): ProposalChoice[] => {
    const summary = item.summary ?? describeProposal(item.tool, item.module as AssistantScope, item.args);
    const list = entryList(item.args);
    if (list) {
      return list.entries.map((e, j) => ({
        key: `${i}.${j}`,
        module: item.module as AssistantScope,
        group: summary,
        label: e.title as string,
        text: e.title as string,
      }));
    }
    return [{ key: String(i), module: item.module as AssistantScope, group: null, label: summary, text: null }];
  });
}

/**
 * The changes to make: only the kept rows, with any new names written into
 * their arguments. A change whose list loses every entry is left out, and the
 * summary of a changed one is written again from its new arguments.
 */
export function applyProposalPicks<T extends ProposalLike>(items: T[], picks: ProposalPick[]): T[] {
  const kept = new Map(picks.map((p) => [p.key, p.text?.trim()]));
  return items.flatMap((item, i) => {
    const list = entryList(item.args);
    let args = item.args;
    if (list) {
      const entries = list.entries.flatMap((e, j) => {
        const key = `${i}.${j}`;
        if (!kept.has(key)) return [];
        const text = kept.get(key);
        return [text ? { ...e, title: text } : e];
      });
      if (entries.length === 0) return [];
      const same = entries.length === list.entries.length && entries.every((e, j) => e === list.entries[j]);
      if (!same) args = { ...args, [list.field]: entries };
    } else if (!kept.has(String(i))) {
      return [];
    }
    if (args === item.args) return [item];
    return [{ ...item, args, summary: describeProposal(item.tool, item.module as AssistantScope, args) }];
  });
}
