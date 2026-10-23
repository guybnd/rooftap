// Scout threads. A Scout run's page is a thread: the person can ask about the
// picks ("is 2 worth $14 more?") or change the search ("up to $160, needs a
// grill"). Scout answers a question in words. A change starts a new run
// linked to the first one (thread_id), and its picks arrive further down the
// same thread. The server decides which it is (apps/web/src/lib/shopper/
// scout-thread.ts); these are the shapes and pure rules both apps share.

import { formatMoney } from '../../money-format';
import { scoutBudgetLabel, type ScoutBrief, type ShopperPick, type ShopperSearch } from './shopper-scout';

/** One message in a Scout thread (shopper_scout_messages). Written by the server only. */
export interface ScoutMessage {
  id: string;
  group_id: string;
  /** The first run of the thread. */
  thread_id: string;
  role: 'user' | 'scout';
  text: string;
  /** The pick a question was about. */
  pick_id: string | null;
  /** The run this message started ("Searching again"). */
  search_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

/** A whole thread: its runs (first run first), every run's picks and the messages. */
export interface ScoutThread {
  runs: ShopperSearch[];
  picks: ShopperPick[];
  messages: ScoutMessage[];
}

/** Longest follow-up the person can send. */
export const SCOUT_FOLLOW_UP_MAX = 400;

/** Messages a person can send in one thread, so one thread can't run up the AI bill. */
export const SCOUT_THREAD_MAX_ASKS = 30;

/** A follow-up from a request body, cleaned, or why it can't be sent. */
export function parseScoutFollowUp(raw: unknown): { text: string; pick_id: string | null } | { error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) return { error: 'Write a question or a change first.' };
  if (text.length > SCOUT_FOLLOW_UP_MAX) return { error: `Keep it under ${SCOUT_FOLLOW_UP_MAX} characters.` };
  const pickId = typeof r.pick_id === 'string' && /^[0-9a-f-]{36}$/i.test(r.pick_id) ? r.pick_id : null;
  return { text, pick_id: pickId };
}

/** How many questions and changes the person has sent in a thread. */
export function scoutAsksUsed(messages: readonly Pick<ScoutMessage, 'role' | 'deleted'>[]): number {
  return messages.filter((m) => m.role === 'user' && !m.deleted).length;
}

export type ScoutThreadItem =
  | { kind: 'run'; run: ShopperSearch; picks: ShopperPick[]; first: boolean }
  | { kind: 'message'; message: ScoutMessage };

/**
 * The thread in reading order: the first run, then each message, with a run
 * a message started placed right after that message. A run no message names
 * (it shouldn't happen) goes in by when it started.
 */
export function scoutTimeline(thread: ScoutThread): ScoutThreadItem[] {
  const runs = [...thread.runs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const first = runs.find((r) => !r.thread_id) ?? runs[0];
  if (!first) return [];
  const picksFor = (id: string) => thread.picks.filter((p) => p.search_id === id && !p.deleted).sort((a, b) => a.rank - b.rank);
  const runItem = (run: ShopperSearch): ScoutThreadItem => ({ kind: 'run', run, picks: picksFor(run.id), first: run.id === first.id });

  const placed = new Set<string>([first.id]);
  const messages = thread.messages.filter((m) => !m.deleted).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const named = new Set(messages.map((m) => m.search_id).filter((id): id is string => !!id));
  // Runs nobody started from a message, slotted in by time.
  const loose = runs.filter((r) => r.id !== first.id && !named.has(r.id));

  const out: ScoutThreadItem[] = [runItem(first)];
  const flushLoose = (before: string | null) => {
    while (loose.length && (before == null || loose[0].created_at <= before)) {
      const run = loose.shift()!;
      placed.add(run.id);
      out.push(runItem(run));
    }
  };
  for (const message of messages) {
    flushLoose(message.created_at);
    out.push({ kind: 'message', message });
    const started = message.search_id ? runs.find((r) => r.id === message.search_id) : undefined;
    if (started && !placed.has(started.id)) {
      placed.add(started.id);
      out.push(runItem(started));
    }
  }
  flushLoose(null);
  return out;
}

/** The run whose picks the Hero counts: the newest one that finished with picks, else the newest. */
export function scoutLatestRun(thread: ScoutThread): ShopperSearch | null {
  const runs = [...thread.runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return runs.find((r) => r.status === 'done' && thread.picks.some((p) => p.search_id === r.id && !p.deleted)) ?? runs[0] ?? null;
}

/**
 * What changed between two briefs, in a few words: "up to $160", "nearby
 * only". The words of the brief itself are left to Scout's own summary.
 */
export function scoutBriefChanges(prev: ScoutBrief, next: ScoutBrief): string[] {
  const out: string[] = [];
  if (prev.budget_min_cents !== next.budget_min_cents || prev.budget_max_cents !== next.budget_max_cents) {
    const onlyMax = next.budget_max_cents != null && next.budget_min_cents == null;
    out.push(onlyMax ? `up to ${formatMoney(next.budget_max_cents!)}` : (scoutBudgetLabel(next) ?? 'any budget'));
  }
  if (prev.need_by !== next.need_by) out.push(next.need_by ? `by ${next.need_by}` : 'no rush');
  const where = (b: ScoutBrief) => [...b.where].sort().join(',');
  if (where(prev) !== where(next)) {
    const labels: Record<string, string> = { nearby: 'nearby', online: 'online', secondhand: 'second hand' };
    out.push(next.where.map((w) => labels[w]).join(' or '));
  }
  return out;
}

/** Scout's line before a refined search: "Searching again: up to $160, with a grill." */
export function scoutRefineLine(summary: string, changes: readonly string[]): string {
  const said = summary.trim().replace(/[.\s]+$/, '').replace(/\s*[—–]\s*/g, ', ');
  const parts = [...changes.filter((c) => !said.toLowerCase().includes(c.toLowerCase())), ...(said ? [said] : [])];
  return parts.length ? `Searching again: ${parts.join(', ')}.` : 'Searching again.';
}

/** Quick follow-ups offered above the composer, from the newest picks. Up to three. */
export function scoutSuggestions(picks: readonly Pick<ShopperPick, 'rank' | 'stretch'>[], brief: Pick<ScoutBrief, 'budget_max_cents'>): string[] {
  const out: string[] = [];
  if (picks.length >= 2) out.push(`Compare ${picks[0].rank} and ${picks[1].rank}`);
  if (picks.length > 0 && picks.every((p) => p.stretch) && brief.budget_max_cents != null) out.push('Why nothing in budget?');
  if (picks.length > 0) out.push('Any cheaper options?');
  if (picks.length === 0) out.push('Try a bigger budget');
  return out.slice(0, 3);
}

/** The composer's starting words when the person asks from a pick's sheet. */
export function scoutPickAskLabel(pick: Pick<ShopperPick, 'rank' | 'title'>): string {
  const title = pick.title.length > 40 ? `${pick.title.slice(0, 39).trimEnd()}…` : pick.title;
  return `About ${pick.rank}: ${title}`;
}
