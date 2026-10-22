// HOUP-435: Scout, Shopper's AI layer. A household describes what it needs
// in its own words, with a budget, a deadline and where to look; a
// server-side agent searches the household's price sources and comes back
// with up to three picks, each with why it fits, today's price and where to
// get it. Picks can be watched (into the Watchlist), planned as a to-do, or
// opened. The run itself is server-side (apps/web/src/lib/shopper/scout.ts);
// these are the shapes and the pure rules both apps share.

import { formatMoney } from './costs';

export type ScoutWhere = 'nearby' | 'online' | 'secondhand';

export const SCOUT_WHERE_LABELS: Record<ScoutWhere, string> = {
  nearby: 'Nearby stores',
  online: 'Online, delivered',
  secondhand: 'Second hand',
};

export interface ScoutBrief {
  /** What they're after, in their own words. */
  text: string;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
  /** YYYY-MM-DD, or null for no rush. */
  need_by: string | null;
  where: ScoutWhere[];
}

export type ScoutStatus = 'running' | 'done' | 'failed';

/** One Scout run (shopper_searches). Written by the server only. */
export interface ShopperSearch {
  id: string;
  group_id: string;
  brief: ScoutBrief;
  status: ScoutStatus;
  /** Why a failed run failed, in words for the person. */
  error: string | null;
  /** Offers the agent looked at across every store, for "checked 14 stores". */
  stores_checked: number;
  /** Whose AI key paid: the household's own, or the server's (Plus allowance). */
  key_source: 'household' | 'server' | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  deleted: boolean;
}

export interface ScoutSource {
  title: string;
  url: string;
}

/** One pick from a run (shopper_picks). Written by the server only. */
export interface ShopperPick {
  id: string;
  group_id: string;
  search_id: string;
  rank: number;
  /** Short role in the list: "best value", "best picture", "stretch". */
  label: string;
  title: string;
  /** Why it fits the brief, one or two sentences. */
  why: string;
  price_cents: number;
  currency: string;
  store: string;
  url: string | null;
  in_stock: boolean | null;
  /** Over budget, shown only with a reason. */
  stretch: boolean;
  sources: ScoutSource[];
  /** The watchlist item made from this pick, once watched. */
  want_id: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export const SCOUT_MAX_PICKS = 3;
export const SCOUT_BRIEF_MAX = 600;

/** Scout runs per Plus household per month on the server's key. A proposal to tune; the household's own key is uncapped. */
export const PLUS_SCOUT_RUNS_PER_MONTH = 20;

/** A brief from a request body, cleaned, or a reason it can't run. */
export function parseScoutBrief(raw: unknown): { brief: ScoutBrief } | { error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (text.length < 3) return { error: 'Say what you are after first.' };
  if (text.length > SCOUT_BRIEF_MAX) return { error: `Keep it under ${SCOUT_BRIEF_MAX} characters.` };
  const cents = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
  let min = cents(r.budget_min_cents);
  let max = cents(r.budget_max_cents);
  if (min != null && max != null && min > max) [min, max] = [max, min];
  const needBy = typeof r.need_by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.need_by) ? r.need_by : null;
  const where = Array.isArray(r.where) ? r.where.filter((w): w is ScoutWhere => w === 'nearby' || w === 'online' || w === 'secondhand') : [];
  return {
    brief: {
      text,
      budget_min_cents: min,
      budget_max_cents: max,
      need_by: needBy,
      where: where.length ? Array.from(new Set(where)) : ['nearby', 'online'],
    },
  };
}

/** A short title for a run, from its brief: the first clause, capped. */
export function scoutTitle(brief: Pick<ScoutBrief, 'text'>): string {
  const first = brief.text.split(/[.!?\n]/)[0].trim();
  return first.length > 40 ? `${first.slice(0, 39).trimEnd()}…` : first;
}

/** The budget in words: "$1,500 to $2,000", "under $2,000", "from $1,500", or null. */
export function scoutBudgetLabel(brief: Pick<ScoutBrief, 'budget_min_cents' | 'budget_max_cents'>): string | null {
  const { budget_min_cents: min, budget_max_cents: max } = brief;
  if (min != null && max != null) return `${formatMoney(min)} to ${formatMoney(max)}`;
  if (max != null) return `under ${formatMoney(max)}`;
  if (min != null) return `from ${formatMoney(min)}`;
  return null;
}

/** The Hero line for a finished run: the count, and what it is ("picks under $2,000"). */
export function scoutHeadline(picks: readonly Pick<ShopperPick, 'stretch'>[], brief: Pick<ScoutBrief, 'budget_max_cents'>): { count: number; caption: string } {
  const count = picks.length;
  const noun = count === 1 ? 'pick' : 'picks';
  return { count, caption: brief.budget_max_cents != null ? `${noun} under ${formatMoney(brief.budget_max_cents)}` : noun };
}

/** Whether a pick is over the brief's budget. */
export function isOverBudget(pick: Pick<ShopperPick, 'price_cents'>, brief: Pick<ScoutBrief, 'budget_max_cents'>): boolean {
  return brief.budget_max_cents != null && pick.price_cents > brief.budget_max_cents;
}

/** A run still "running" after this long died with its server call; show it as failed. */
export const SCOUT_STALE_MS = 3 * 60 * 1000;

/** The status to show for a run, treating a run that never finished as failed. */
export function scoutRunStatus(search: Pick<ShopperSearch, 'status' | 'created_at'>, now: number = Date.now()): ScoutStatus {
  if (search.status === 'running' && now - new Date(search.created_at).getTime() > SCOUT_STALE_MS) return 'failed';
  return search.status;
}

/** Why a run failed, in words for the person. */
export function scoutFailure(search: Pick<ShopperSearch, 'status' | 'error' | 'created_at'>, now: number = Date.now()): string | null {
  if (scoutRunStatus(search, now) !== 'failed') return null;
  return search.error ?? 'Scout stopped before it finished. Try again.';
}

/** The caption under a run's Hero: "checked 14 stores". */
export function scoutStoresCaption(search: Pick<ShopperSearch, 'stores_checked'>): string | null {
  const n = search.stores_checked;
  return n > 0 ? `checked ${n} ${n === 1 ? 'store' : 'stores'}` : null;
}

/** Need-by choices on the brief sheet, as days from today (null for no rush). */
export const SCOUT_NEED_BY_OPTIONS: { value: 'none' | '7' | '14' | '30'; label: string; days: number | null }[] = [
  { value: 'none', label: 'No rush', days: null },
  { value: '7', label: 'This week', days: 7 },
  { value: '14', label: '2 weeks', days: 14 },
  { value: '30', label: 'A month', days: 30 },
];

/** Whether a blocked-AI code means the household should add its own key or get Plus. */
export function isAiBlockedCode(code: string | null | undefined): code is 'ai_requires_plus' | 'ai_allowance_used' | 'ai_not_configured' {
  return code === 'ai_requires_plus' || code === 'ai_allowance_used' || code === 'ai_not_configured';
}

/** What another section hands Scout to start a brief from: the words and an upper budget, as typed. */
export interface ScoutPrefill {
  text: string;
  upTo: string;
}

/**
 * A Home Setup item as a Scout brief: its name, its notes when it has some,
 * and its estimate (whole currency units) as the "up to" budget.
 */
export function scoutPrefillFromSetupItem(item: { name: string; notes?: string | null; est_price?: number | null }): ScoutPrefill {
  const name = item.name.trim();
  const notes = item.notes?.trim();
  const text = (notes ? `${name}. ${notes}` : name).slice(0, SCOUT_BRIEF_MAX);
  const upTo = item.est_price && item.est_price > 0 ? String(item.est_price) : '';
  return { text, upTo };
}

/** The Shopper route that opens the Scout brief with this prefill. Both apps use it. */
export function scoutPrefillHref(prefill: ScoutPrefill): string {
  // Built by hand: React Native's URLSearchParams has no set().
  const query = `scout=${encodeURIComponent(prefill.text)}${prefill.upTo ? `&upto=${encodeURIComponent(prefill.upTo)}` : ''}`;
  return `/shopper?${query}`;
}

/** Reads a prefill back from route params (web query string or expo-router params). */
export function readScoutPrefill(params: Record<string, string | string[] | null | undefined>): ScoutPrefill | null {
  const first = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const text = first(params.scout).trim().slice(0, SCOUT_BRIEF_MAX);
  if (!text) return null;
  const upTo = first(params.upto).replace(/[^0-9.]/g, '');
  return { text, upTo };
}
