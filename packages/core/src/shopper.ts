// Shopper (HOUP-434): things the household wants to buy, the offers sources
// find for them, and the price history behind the deal rating. Mockups:
// /mnt/project-files/design/shopper/. Money is integer minor units (cents),
// like Costs. Everything here is pure so web, mobile and the server agree.

import type { CostItem, HouseholdTask } from './types';

export type ShopperWantStatus = 'watching' | 'idea' | 'bought';

export const SHOPPER_WANT_STATUSES: readonly ShopperWantStatus[] = ['watching', 'idea', 'bought'];

export interface ShopperWant {
  id: string;
  group_id: string;
  title: string;
  /** What sources search for; null means the title. */
  query: string | null;
  /** Alert when the cheapest offer is at or under this. */
  target_cents: number | null;
  /** The most the household wants to spend. */
  budget_cents: number | null;
  status: ShopperWantStatus;
  /** YYYY-MM-DD, optional. */
  need_by: string | null;
  notes: string | null;
  /** Cheapest offer at the last check, denormalised for lists and Home. */
  best_cents: number | null;
  best_store: string | null;
  last_checked_at: string | null;
  bought_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface ShopperOffer {
  id: string;
  group_id: string;
  want_id: string;
  /** The source that found it (shopper-sources.ts manifest id). */
  source_id: string;
  store: string;
  title: string;
  url: string | null;
  price_cents: number;
  currency: string;
  /** null when the source doesn't say. */
  in_stock: boolean | null;
  /** Metres from the household, when the source knows the store's location. */
  distance_m: number | null;
  checked_at: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface ShopperPriceSnapshot {
  id: string;
  group_id: string;
  want_id: string;
  source_id: string;
  store: string;
  price_cents: number;
  currency: string;
  /** YYYY-MM-DD; one row per want, source, store and day. */
  captured_on: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

/** The text sources search for. */
export function wantQuery(want: Pick<ShopperWant, 'title' | 'query'>): string {
  return (want.query?.trim() || want.title).trim();
}

// ── Price history ───────────────────────────────────────────────────────────

export interface DailyPrice {
  day: string;
  cents: number;
}

/** The cheapest price per day across every store, oldest first. */
export function dailyLows(snapshots: readonly Pick<ShopperPriceSnapshot, 'captured_on' | 'price_cents'>[]): DailyPrice[] {
  const byDay = new Map<string, number>();
  for (const s of snapshots) {
    if (!(s.price_cents > 0)) continue;
    const prev = byDay.get(s.captured_on);
    if (prev === undefined || s.price_cents < prev) byDay.set(s.captured_on, s.price_cents);
  }
  return Array.from(byDay, ([day, cents]) => ({ day, cents })).sort((a, b) => a.day.localeCompare(b.day));
}

/** Days within `days` of `today` (inclusive), from a sorted daily series. */
export function priceWindow(series: readonly DailyPrice[], today: string, days: number): DailyPrice[] {
  const from = shiftDay(today, -(days - 1));
  return series.filter((p) => p.day >= from && p.day <= today);
}

export interface PriceStats {
  /** Days with a price in the window. */
  days: number;
  low: number;
  high: number;
  median: number;
}

export function priceStats(series: readonly DailyPrice[]): PriceStats | null {
  if (series.length === 0) return null;
  const sorted = series.map((p) => p.cents).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { days: sorted.length, low: sorted[0], high: sorted[sorted.length - 1], median };
}

// ── Deal rating ─────────────────────────────────────────────────────────────

export type DealRating = 'great' | 'good' | 'fair' | 'wait';

/** Days of history before a rating is shown; until then it's "not enough history". */
export const DEAL_MIN_HISTORY_DAYS = 14;
/** The window "usual price" is measured over. */
export const DEAL_WINDOW_DAYS = 90;

export interface DealVerdict {
  rating: DealRating | null;
  /** Today's price against the window's median, as a fraction (0.17 = 17% under). */
  underUsual: number | null;
  stats: PriceStats | null;
  /** At or below the window's low. */
  isLow: boolean;
}

/**
 * The one deal formula (tickets.md): Great at or below the 90-day low or 15%+
 * under the median; Good 5 to 15% under; Fair within 5%; Wait above. Fewer
 * than DEAL_MIN_HISTORY_DAYS days of prices gives no rating. History before
 * today counts toward the low, so a new low is Great on the day it happens.
 */
export function dealVerdict(nowCents: number | null, series: readonly DailyPrice[], today: string): DealVerdict {
  const window = priceWindow(series, today, DEAL_WINDOW_DAYS);
  const stats = priceStats(window);
  if (nowCents == null || !stats) return { rating: null, underUsual: null, stats, isLow: false };
  const underUsual = stats.median > 0 ? (stats.median - nowCents) / stats.median : null;
  const isLow = nowCents <= stats.low;
  if (stats.days < DEAL_MIN_HISTORY_DAYS) return { rating: null, underUsual, stats, isLow };
  let rating: DealRating;
  if (isLow || (underUsual ?? 0) >= 0.15) rating = 'great';
  else if ((underUsual ?? 0) >= 0.05) rating = 'good';
  else if ((underUsual ?? 0) >= -0.05) rating = 'fair';
  else rating = 'wait';
  return { rating, underUsual, stats, isLow };
}

export const DEAL_META: Record<DealRating, { label: string; tone: 'success' | 'muted' | 'warning' }> = {
  great: { label: 'Great deal', tone: 'success' },
  good: { label: 'Good deal', tone: 'success' },
  fair: { label: 'Fair', tone: 'muted' },
  wait: { label: 'Above usual', tone: 'warning' },
};

/** Where `cents` sits between the window's low (0) and high (1), for the 3px position meter. */
export function pricePosition(cents: number, stats: PriceStats | null): number | null {
  if (!stats || stats.high <= stats.low) return null;
  return Math.min(1, Math.max(0, (cents - stats.low) / (stats.high - stats.low)));
}

/** Whether the cheapest price has reached the household's target. */
export function hitTarget(want: Pick<ShopperWant, 'target_cents' | 'best_cents'>): boolean {
  return want.target_cents != null && want.best_cents != null && want.best_cents <= want.target_cents;
}

// ── Offers ──────────────────────────────────────────────────────────────────

/** Live offers for a want, cheapest first; in-stock before unknown before out of stock at the same price. */
export function sortOffers<T extends Pick<ShopperOffer, 'price_cents' | 'in_stock' | 'distance_m' | 'store'>>(offers: readonly T[]): T[] {
  const stockRank = (o: T) => (o.in_stock === true ? 0 : o.in_stock === null ? 1 : 2);
  return [...offers].sort(
    (a, b) =>
      a.price_cents - b.price_cents ||
      stockRank(a) - stockRank(b) ||
      (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity) ||
      a.store.localeCompare(b.store),
  );
}

/** How long a check stays fresh before opening the want checks again. */
export const SHOPPER_STALE_MS = 6 * 60 * 60 * 1000;

export function isWantStale(want: Pick<ShopperWant, 'last_checked_at' | 'status'>, now: Date = new Date()): boolean {
  if (want.status === 'bought') return false;
  if (!want.last_checked_at) return true;
  return now.getTime() - new Date(want.last_checked_at).getTime() > SHOPPER_STALE_MS;
}

// ── Lists and Home ──────────────────────────────────────────────────────────

export interface ShopperRowSummary {
  want: ShopperWant;
  verdict: DealVerdict;
  /** Daily lows for the sparkline (last 30 days). */
  trend: DailyPrice[];
}

/** One summary per want, from the household's snapshots. */
export function summarizeWants(
  wants: readonly ShopperWant[],
  snapshots: readonly ShopperPriceSnapshot[],
  today: string,
): ShopperRowSummary[] {
  const byWant = new Map<string, ShopperPriceSnapshot[]>();
  for (const s of snapshots) {
    if (s.deleted) continue;
    const arr = byWant.get(s.want_id) ?? [];
    arr.push(s);
    byWant.set(s.want_id, arr);
  }
  return wants.map((want) => {
    const series = dailyLows(byWant.get(want.id) ?? []);
    return {
      want,
      verdict: dealVerdict(want.best_cents, series, today),
      trend: priceWindow(series, today, 30),
    };
  });
}

/** A want worth acting on now: a Great or Good rating, or its target hit. */
export function isGoodNow(row: ShopperRowSummary): boolean {
  if (row.want.status !== 'watching') return false;
  return hitTarget(row.want) || row.verdict.rating === 'great' || row.verdict.rating === 'good';
}

/** Watching list order: good now first, then by name. */
export function sortWatching(rows: readonly ShopperRowSummary[]): ShopperRowSummary[] {
  return [...rows].sort(
    (a, b) => Number(isGoodNow(b)) - Number(isGoodNow(a)) || a.want.title.localeCompare(b.want.title),
  );
}

/** The verdict line under a row or the detail Hero, e.g. "Great deal · 17% under usual". */
export function verdictCaption(verdict: DealVerdict, want: Pick<ShopperWant, 'target_cents' | 'best_cents'>): string {
  if (want.best_cents == null) return 'Not checked yet';
  const parts: string[] = [];
  if (hitTarget(want)) parts.push('Hit target');
  if (verdict.rating) {
    if (!(hitTarget(want) && (verdict.rating === 'fair' || verdict.rating === 'wait'))) parts.push(DEAL_META[verdict.rating].label);
    if (verdict.underUsual != null && Math.abs(verdict.underUsual) >= 0.01) {
      const pct = Math.round(Math.abs(verdict.underUsual) * 100);
      parts.push(verdict.underUsual > 0 ? `${pct}% under usual` : `${pct}% over usual`);
    }
  } else if (!parts.length) {
    parts.push('Not enough history');
  }
  return parts.join(' · ');
}

/** "3.2 km", "800 m": distance to a store, for an offer's meta line. */
export function formatDistance(metres: number | null | undefined): string | null {
  if (metres == null || !Number.isFinite(metres)) return null;
  if (metres < 1000) return `${Math.max(100, Math.round(metres / 100) * 100)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/** The usual price range shown on the chart: the window's middle half around the median. */
export function usualRange(stats: PriceStats | null): { from: number; to: number } | null {
  if (!stats || stats.days < DEAL_MIN_HISTORY_DAYS) return null;
  return { from: Math.round(stats.median * 0.95), to: Math.round(stats.median * 1.05) };
}

/** "Buy <title> at <store>", the to-do Plan to buy creates. */
export function planToBuyTitle(want: Pick<ShopperWant, 'title'>, store: string | null): string {
  return store ? `Buy ${want.title} at ${store}` : `Buy ${want.title}`;
}

/** A new want, as the add sheet saves it. The server fills in prices. */
export function buildShopperWant(input: {
  id: string;
  groupId: string;
  title: string;
  query?: string | null;
  targetCents?: number | null;
  budgetCents?: number | null;
  needBy?: string | null;
  notes?: string | null;
  status?: ShopperWantStatus;
  createdBy: string | null;
  now?: Date;
}): ShopperWant {
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: input.id,
    group_id: input.groupId,
    title: input.title.trim(),
    query: input.query?.trim() || null,
    target_cents: input.targetCents ?? null,
    budget_cents: input.budgetCents ?? null,
    status: input.status ?? 'watching',
    need_by: input.needBy || null,
    notes: input.notes?.trim() || null,
    best_cents: null,
    best_store: null,
    last_checked_at: null,
    bought_at: null,
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

/**
 * Plan to buy's to-do (shopper.tasks): "Buy <item> at <store>", due on the
 * want's need-by date when it has one. Notes carry the price and link so the
 * to-do stands on its own.
 */
export function buildPlanToBuyTask(input: {
  id: string;
  want: ShopperWant;
  offer: Pick<ShopperOffer, 'store' | 'price_cents' | 'url'> | null;
  priceLabel: string | null;
  now?: Date;
}): HouseholdTask {
  const now = (input.now ?? new Date()).toISOString();
  const notes = [input.priceLabel, input.offer?.url].filter(Boolean).join('\n') || null;
  return {
    id: input.id,
    group_id: input.want.group_id,
    title: planToBuyTitle(input.want, input.offer?.store ?? null),
    due_date: input.want.need_by,
    due_time: null,
    offset_days: null,
    recurrence_days: null,
    done: false,
    completed_at: null,
    assigned_to: null,
    private: false,
    template_key: null,
    notes,
    sort_order: 0,
    priority: null,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

/** Plan to buy's cost (shopper.costs): a one-off Purchase at the offer's price, an estimate until bought. */
export function buildPlanToBuyCost(input: {
  id: string;
  want: ShopperWant;
  offer: Pick<ShopperOffer, 'store' | 'price_cents'> | null;
  now?: Date;
}): CostItem {
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: input.id,
    group_id: input.want.group_id,
    name: input.want.title,
    category: 'purchase',
    amount: input.offer?.price_cents ?? input.want.best_cents ?? input.want.budget_cents ?? 0,
    cadence: 'one_off',
    is_estimate: true,
    start_date: input.want.need_by ?? now.slice(0, 10),
    end_date: null,
    discount_end_date: null,
    provider: input.offer?.store ?? null,
    assigned_to: null,
    linked_section: 'shopper',
    notes: null,
    sort_order: 0,
    created_by: null,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

/** Parses a typed price ("1,799", "$1799.95") into cents; null when blank or not a price. */
export function parsePriceInput(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

/**
 * Home's Shopper shortcut (a summary-hero `home` module): how many watched
 * items are at a good price, or how many are watched when none is. Null with
 * nothing watched, so the shortcut takes no slot.
 */
export function shopperShortcutValue(rows: readonly ShopperRowSummary[]): string | null {
  const watching = rows.filter((r) => r.want.status === 'watching');
  if (!watching.length) return null;
  const good = watching.filter(isGoodNow).length;
  if (good > 0) return `${good} good ${good === 1 ? 'deal' : 'deals'}`;
  return `${watching.length} watching`;
}
