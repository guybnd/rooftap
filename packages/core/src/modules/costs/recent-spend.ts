// Recent spending (Guy, 2026-10-24): how much went out today, over the last
// few days and over the last week, each set against a usual stretch of the
// same length. It sits on the Costs Latest card on web and phone. The server
// sends money out per local day (up-bank dayRows); these helpers add up the
// windows. Bills (payments filed under a recurring cost line) stay out by
// default, so a rent day doesn't swamp the week. Platform-agnostic.

import { isOneOff } from './costs';
import { formatMoney } from '../../money-format';
import type { CostItem } from '../../types';

/** Money out on one local day, per cost line. */
export interface DaySpend {
  /** YYYY-MM-DD, the viewer's local day. */
  day: string;
  /** The cost line these payments are filed under, if any. */
  costItemId: string | null;
  /** Money out, positive cents. */
  outCents: number;
}

/** How many days back the server sends: the windows plus the usual. */
export const RECENT_DAYS_BACK = 98;
/** How many full days before today the usual looks at. */
export const USUAL_DAYS = 84;
/** The windows a person can pick, in days (1 is today). */
export const RECENT_WINDOW_CHOICES = [1, 2, 3, 7, 14, 30] as const;
export type RecentWindow = (typeof RECENT_WINDOW_CHOICES)[number];
/** At most this many windows show. */
export const MAX_RECENT_WINDOWS = 3;

/** A person's recent spending choices, stored in user_settings.costs_recent_spend. */
export interface RecentSpendPrefs {
  windows: RecentWindow[];
  /** Leave out payments filed under a recurring cost line. */
  skipBills: boolean;
  /** Off hides the strip. */
  show: boolean;
}

export const DEFAULT_RECENT_SPEND: RecentSpendPrefs = { windows: [1, 3, 7], skipBills: true, show: true };

/** Stored choices, made safe: unknown windows dropped, sorted, at most three. */
export function readRecentSpendPrefs(raw: unknown): RecentSpendPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_RECENT_SPEND;
  const r = raw as Partial<Record<keyof RecentSpendPrefs, unknown>>;
  const windows = Array.isArray(r.windows)
    ? Array.from(new Set(r.windows.filter((w): w is RecentWindow => (RECENT_WINDOW_CHOICES as readonly unknown[]).includes(w))))
        .sort((a, b) => a - b)
        .slice(0, MAX_RECENT_WINDOWS)
    : DEFAULT_RECENT_SPEND.windows;
  return {
    windows: windows.length ? windows : DEFAULT_RECENT_SPEND.windows,
    skipBills: typeof r.skipBills === 'boolean' ? r.skipBills : DEFAULT_RECENT_SPEND.skipBills,
    show: typeof r.show === 'boolean' ? r.show : DEFAULT_RECENT_SPEND.show,
  };
}

/** Turn a window on or off: on adds it (dropping the longest when three show), off keeps at least one. */
export function toggleRecentWindow(prefs: RecentSpendPrefs, w: RecentWindow): RecentSpendPrefs {
  if (prefs.windows.includes(w)) {
    if (prefs.windows.length === 1) return prefs;
    return { ...prefs, windows: prefs.windows.filter((x) => x !== w) };
  }
  const windows = [...prefs.windows, w].sort((a, b) => a - b);
  if (windows.length > MAX_RECENT_WINDOWS) windows.splice(windows.indexOf(Math.max(...prefs.windows) as RecentWindow), 1);
  return { ...prefs, windows };
}

export function recentWindowLabel(w: number): string {
  return w === 1 ? 'Today' : `${w} days`;
}

export type RecentVerdict = 'under' | 'usual' | 'over';

export interface RecentSpendWindow {
  days: number;
  label: string;
  cents: number;
  /** A usual stretch this long; null without enough history. */
  usualCents: number | null;
  /** cents minus usual; null without a usual. */
  diffCents: number | null;
  verdict: RecentVerdict | null;
}

/** Within this share of usual (or this many cents) counts as about usual. */
const USUAL_SHARE = 0.15;
const USUAL_CENTS = 1000;
/** A usual needs at least this many days of history. */
const MIN_USUAL_DAYS = 14;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBefore(now: Date, n: number): string {
  return dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
}

/** Money out per local day, bills left out when asked, and the first day the data has. */
function spendByDay(
  days: readonly DaySpend[],
  items: readonly Pick<CostItem, 'id' | 'cadence' | 'deleted'>[],
  skipBills: boolean,
): { byDay: Map<string, number>; first: string | null } {
  const bills = billLines(items, skipBills);
  const byDay = new Map<string, number>();
  let first: string | null = null;
  for (const d of days) {
    if (!first || d.day < first) first = d.day;
    if (d.costItemId && bills.has(d.costItemId)) continue;
    byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.outCents);
  }
  return { byDay, first };
}

/** The recurring cost lines whose payments count as bills, or none when bills count. */
export function billLines(items: readonly Pick<CostItem, 'id' | 'cadence' | 'deleted'>[], skipBills: boolean): Set<string> {
  return new Set(skipBills ? items.filter((i) => !i.deleted && !isOneOff(i)).map((i) => i.id) : []);
}

/** Where a window starts: local midnight of its first day. */
export function recentWindowStart(w: number, now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (w - 1));
}

export interface RecentBar {
  /** YYYY-MM-DD. */
  day: string;
  cents: number;
  /** Inside the window. */
  lit: boolean;
  today: boolean;
}

/**
 * The bars under an open window: one per day for the last two weeks (or the
 * window, when longer), the window's own days lit, oldest first.
 */
export function recentBars(
  days: readonly DaySpend[],
  items: readonly Pick<CostItem, 'id' | 'cadence' | 'deleted'>[],
  skipBills: boolean,
  w: number,
  now: Date = new Date(),
): RecentBar[] {
  const { byDay } = spendByDay(days, items, skipBills);
  const count = Math.max(14, w);
  return Array.from({ length: count }, (_, i) => {
    const n = count - 1 - i;
    const day = daysBefore(now, n);
    return { day, cents: byDay.get(day) ?? 0, lit: n < w, today: n === 0 };
  });
}

/**
 * Each window's total, ending today (today counts as day one), with a usual
 * stretch of the same length: the average day over the USUAL_DAYS full days
 * before today (fewer when the bank data starts later), times the window.
 */
export function recentSpend(
  days: readonly DaySpend[],
  items: readonly Pick<CostItem, 'id' | 'cadence' | 'deleted'>[],
  prefs: Pick<RecentSpendPrefs, 'windows' | 'skipBills'>,
  now: Date = new Date(),
): RecentSpendWindow[] {
  const { byDay, first } = spendByDay(days, items, prefs.skipBills);
  const sumBack = (from: number, to: number) => {
    let s = 0;
    for (let n = from; n < to; n++) s += byDay.get(daysBefore(now, n)) ?? 0;
    return s;
  };
  // Full days before today that the data covers (the first day may be partial, so it's left out).
  let covered = 0;
  if (first) for (let n = 1; n <= USUAL_DAYS && daysBefore(now, n) > first; n++) covered++;
  const perDay = covered >= MIN_USUAL_DAYS ? sumBack(1, covered + 1) / covered : null;

  return prefs.windows.map((w) => {
    const cents = sumBack(0, w);
    const usualCents = perDay == null ? null : Math.round(perDay * w);
    const diffCents = usualCents == null ? null : cents - usualCents;
    let verdict: RecentVerdict | null = null;
    if (usualCents != null && diffCents != null) {
      verdict = Math.abs(diffCents) <= Math.max(USUAL_CENTS, usualCents * USUAL_SHARE) ? 'usual' : diffCents > 0 ? 'over' : 'under';
    }
    return { days: w, label: recentWindowLabel(w), cents, usualCents, diffCents, verdict };
  });
}

/** A window's line under its total: "$34 under usual", "About usual", or null without a usual. */
export function recentVerdictText(w: Pick<RecentSpendWindow, 'verdict' | 'diffCents'>): string | null {
  if (!w.verdict || w.diffCents == null) return null;
  if (w.verdict === 'usual') return 'About usual';
  return `${formatMoney(Math.abs(w.diffCents))} ${w.verdict} usual`;
}

/** A YYYY-MM-DD day as a short local date, "11 Oct". */
export function recentDayLabel(day: string | undefined): string {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
