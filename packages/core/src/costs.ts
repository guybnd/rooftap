// FLUX-66: Cost normalization helpers.
// Every recurring cadence converts to a canonical weekly/monthly/yearly figure.
// One-off costs are NOT amortized — they count once toward the yearly total and
// are surfaced separately as upcoming, per the product spec.

import { getHouseholdCurrency, moneyFormatter } from './currency';
import type { CostCadence, CostCategory, CostItem } from './types';

export type Period = "weekly" | "monthly" | "yearly";

// Occurrences per year for each recurring cadence.
const PER_YEAR: Record<Exclude<CostCadence, "one_off">, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

const PERIODS_PER_YEAR: Record<Period, number> = {
  weekly: 52,
  monthly: 12,
  yearly: 1,
};

/** Annualized amount (minor units) for a recurring cost. One-off → 0 here. */
export function annualAmount(item: Pick<CostItem, "amount" | "cadence">): number {
  if (item.cadence === "one_off") return 0;
  return item.amount * PER_YEAR[item.cadence];
}

/** Recurring cost expressed in the requested period (minor units). One-off → 0. */
export function amountForPeriod(
  item: Pick<CostItem, "amount" | "cadence">,
  period: Period
): number {
  if (item.cadence === "one_off") return 0;
  return annualAmount(item) / PERIODS_PER_YEAR[period];
}

export function isOneOff(item: Pick<CostItem, "cadence">): boolean {
  return item.cadence === "one_off";
}

/** Sum of recurring items in the given period (minor units). */
export function totalForPeriod(items: CostItem[], period: Period): number {
  return items.reduce((sum, i) => sum + amountForPeriod(i, period), 0);
}

/** Sum of one-off items (minor units) — counted once, e.g. toward the yearly view. */
export function totalOneOff(items: CostItem[]): number {
  return items.filter(isOneOff).reduce((sum, i) => sum + i.amount, 0);
}

/**
 * Format minor units as whole currency units, in the household's currency
 * (currency.ts) unless `currency` is given.
 */
export function formatMoney(minorUnits: number, { currency = getHouseholdCurrency() }: { currency?: string } = {}): string {
  const units = minorUnits / 100;
  const formatter = moneyFormatter(currency);
  return formatter ? formatter.format(units) : `${currency} ${Math.round(units)}`;
}

export const CATEGORY_META: Record<CostCategory, { label: string; color: string }> = {
  rent: { label: "Rent", color: "bg-blue-900/40 text-blue-300" },
  utilities: { label: "Utilities", color: "bg-amber-900/40 text-amber-300" },
  internet: { label: "Internet", color: "bg-cyan-900/40 text-cyan-300" },
  insurance: { label: "Insurance", color: "bg-emerald-900/40 text-emerald-300" },
  subscription: { label: "Subscription", color: "bg-purple-900/40 text-purple-300" },
  grocery_estimate: { label: "Groceries", color: "bg-green-900/40 text-green-300" },
  moving: { label: "Moving", color: "bg-orange-900/40 text-orange-300" },
  purchase: { label: "Purchase", color: "bg-rose-900/40 text-rose-300" },
  outing: { label: "Going out", color: "bg-purple-900/40 text-purple-300" },
  other: { label: "Other", color: "bg-slate-700 text-slate-300" },
};

// Per-category palette for tints, bars, dots, and the projection chart, so the
// whole Costs section uses one consistent colour per category. Every entry
// also carries a `cat-idx-N` marker class (N = position in CATEGORY_ORDER,
// i.e. Object.keys order above). The markers were added for e-ink's grayscale
// overrides (FLUX-252 review); since HOUP-295 retired that theme no CSS rule
// targets them — they're inert hooks kept for any future theme-scoped
// per-category override. The hues sit evenly round the wheel (blue, yellow,
// cyan, violet, pink, lime, orange, fuchsia, sky, slate) so neighbouring
// segments never blur. They key a chart series next to a legend, so yellow
// and lime don't read as warning or success, and none is the coral accent.
// One swatch holds on both grounds (Hearth §3, chart series).
export const CATEGORY_COLOR: Record<
  CostCategory,
  { fill: string; border: string; dot: string; text: string }
> = {
  rent: { fill: "bg-blue-500 cat-idx-0", border: "border-l-blue-500/60 cat-idx-0", dot: "bg-blue-500 cat-idx-0", text: "text-blue-500 cat-idx-0" },
  utilities: { fill: "bg-yellow-400 cat-idx-1", border: "border-l-yellow-400/60 cat-idx-1", dot: "bg-yellow-400 cat-idx-1", text: "text-yellow-400 cat-idx-1" },
  internet: { fill: "bg-cyan-400 cat-idx-2", border: "border-l-cyan-400/60 cat-idx-2", dot: "bg-cyan-400 cat-idx-2", text: "text-cyan-400 cat-idx-2" },
  insurance: { fill: "bg-violet-500 cat-idx-3", border: "border-l-violet-500/60 cat-idx-3", dot: "bg-violet-500 cat-idx-3", text: "text-violet-500 cat-idx-3" },
  subscription: { fill: "bg-pink-500 cat-idx-4", border: "border-l-pink-500/60 cat-idx-4", dot: "bg-pink-500 cat-idx-4", text: "text-pink-500 cat-idx-4" },
  grocery_estimate: { fill: "bg-lime-500 cat-idx-5", border: "border-l-lime-500/60 cat-idx-5", dot: "bg-lime-500 cat-idx-5", text: "text-lime-500 cat-idx-5" },
  moving: { fill: "bg-orange-400 cat-idx-6", border: "border-l-orange-400/60 cat-idx-6", dot: "bg-orange-400 cat-idx-6", text: "text-orange-400 cat-idx-6" },
  purchase: { fill: "bg-fuchsia-500 cat-idx-7", border: "border-l-fuchsia-500/60 cat-idx-7", dot: "bg-fuchsia-500 cat-idx-7", text: "text-fuchsia-500 cat-idx-7" },
  outing: { fill: "bg-sky-300 cat-idx-8", border: "border-l-sky-300/60 cat-idx-8", dot: "bg-sky-300 cat-idx-8", text: "text-sky-300 cat-idx-8" },
  other: { fill: "bg-slate-500 cat-idx-9", border: "border-l-slate-500/60 cat-idx-9", dot: "bg-slate-500 cat-idx-9", text: "text-slate-500 cat-idx-9" },
};

/** Monthly-equivalent of a recurring cost (minor units). One-off → 0. */
export function monthlyAmount(item: Pick<CostItem, "amount" | "cadence">): number {
  return annualAmount(item) / 12;
}

export interface MonthBucket {
  label: string;
  total: number;
  byCategory: Record<string, number>;
  /** Recurring baseline for the month (flat recurring items + is_estimate step-back effective). */
  recurring: number;
  /** Named one-off spend landing in the month (excludes real actuals already folded into an is_estimate category's step-back — see the double-count guard below). */
  oneOff: number;
  /** The named one-offs behind `oneOff`, so the UI can list them (never an anonymous lump). `category` lets a consumer split a category's `byCategory` total into its recurring vs. one-off portion without double counting. */
  oneOffItems: { name: string; category: string; amount: number }[];
}

export interface StepBackResult {
  /** Sum of monthly-equivalent recurring is_estimate items in this category. */
  est: number;
  /** Real (non-estimate one-off) spend logged for this category in this month. */
  act: number;
  /** The figure this category should contribute to a monthly total. */
  effective: number;
  /** Not-yet-covered slice of the estimate — meaningful for current/future months. */
  remaining: number;
}

/**
 * Per-category step-back for a single calendar month (FLUX-1563). An
 * `is_estimate` recurring item is a forward *projection*, never a backward
 * one:
 * - Current/future month (`monthStart >= currentMonthStart`): the estimate
 *   fills the remaining gap — `effective = max(est, act)`. Real spend eats
 *   into the estimate; overspend makes actuals take over.
 * - Past/settled month (`monthStart < currentMonthStart`): `effective = act`
 *   once any real spend was logged that month — the estimate never backfills
 *   a finished month. A fully untracked past month (zero actuals) keeps
 *   showing its estimate, to avoid a false empty bar.
 *
 * Only returns entries for categories that carry at least one `is_estimate`
 * recurring item — categories with no estimate have no step-back concept and
 * their one-off actuals pass through the caller's normal totals unchanged.
 * Category-generic: keyed on `is_estimate` recurring vs. same-category
 * non-estimate one-off actuals, not hardcoded to any one category.
 */
export function stepBackByCategory(
  items: CostItem[],
  monthStart: Date,
  currentMonthStart: Date
): Record<string, StepBackResult> {
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const isPast = monthStart.getTime() < currentMonthStart.getTime();

  const est: Record<string, number> = {};
  const act: Record<string, number> = {};

  for (const item of items) {
    if (item.is_estimate && !isOneOff(item)) {
      est[item.category] = (est[item.category] ?? 0) + monthlyAmount(item);
    } else if (!item.is_estimate && isOneOff(item) && item.amount > 0 && item.start_date) {
      const d = parseLocalDateOnly(item.start_date);
      if (d >= monthStart && d <= monthEnd) {
        act[item.category] = (act[item.category] ?? 0) + item.amount;
      }
    }
  }

  const result: Record<string, StepBackResult> = {};
  for (const category of Object.keys(est)) {
    const e = est[category];
    const a = act[category] ?? 0;
    const effective = isPast ? (a > 0 ? a : e) : Math.max(e, a);
    result[category] = { est: e, act: a, effective, remaining: Math.max(e - a, 0) };
  }
  return result;
}

/**
 * A bucket's recurring spend split by category, in CATEGORY_META order, with
 * each category's named one-offs subtracted (byCategory mixes both). Shared
 * by the monthly chart's stacked bars and the breakdown strip so one
 * category reads the same color and size in both places.
 */
export function recurringByCategory(bucket: MonthBucket): { category: CostCategory; amount: number }[] {
  const oneOff: Record<string, number> = {};
  for (const o of bucket.oneOffItems) oneOff[o.category] = (oneOff[o.category] ?? 0) + o.amount;
  return (Object.keys(CATEGORY_META) as CostCategory[])
    .map((category) => ({ category, amount: (bucket.byCategory[category] ?? 0) - (oneOff[category] ?? 0) }))
    .filter((s) => s.amount > 0);
}

/**
 * 12-month forward projection (minor units). Recurring costs contribute their
 * monthly-equivalent every month; one-offs land in their start_date month when
 * it falls inside the window, otherwise in the first month. `is_estimate`
 * recurring items instead go through the shared step-back rule (FLUX-1563) so
 * the chart, the "vs last month" tile, and the headline all agree. Drives the
 * chart.
 *
 * `now` is the true current month, independent of `from` — the MoM caller
 * projects from `startOfPrevMonth`, so bucket 0 there is a *past* month while
 * bucket 0 is the *current* month for the chart's own `from = today` call.
 * Passing `now` explicitly keeps the past-vs-current classification keyed off
 * real calendar months, not the bucket index.
 */
export function monthlyProjection(items: CostItem[], from: Date, months = 12, now: Date = new Date()): MonthBucket[] {
  const buckets: MonthBucket[] = Array.from({ length: months }, (_, k) => {
    const d = new Date(from.getFullYear(), from.getMonth() + k, 1);
    return {
      label: d.toLocaleString("en-AU", { month: "short" }),
      total: 0,
      byCategory: {},
      recurring: 0,
      oneOff: 0,
      oneOffItems: [],
    };
  });

  // `kind` splits every contribution into the recurring baseline or a named
  // one-off (FLUX-1578) so `recurring + oneOff === total` always holds —
  // `byCategory`/`total` stay exactly as before, this only adds bookkeeping.
  // Gating the `oneOffItems` push on the same idx<0||idx>=months guard as the
  // rest of `add` (rather than a separate check at the call site) means an
  // out-of-window one-off can never land a named row in a nonexistent bucket.
  const add = (
    idx: number,
    category: string,
    amount: number,
    kind: "recurring" | "oneOff",
    name?: string
  ) => {
    if (idx < 0 || idx >= months || amount <= 0) return;
    buckets[idx].byCategory[category] = (buckets[idx].byCategory[category] ?? 0) + amount;
    buckets[idx].total += amount;
    if (kind === "recurring") {
      buckets[idx].recurring += amount;
    } else {
      buckets[idx].oneOff += amount;
      if (name) buckets[idx].oneOffItems.push({ name, category, amount });
    }
  };

  const monthIndex = (dateStr: string) => {
    const d = new Date(dateStr);
    return (d.getFullYear() - from.getFullYear()) * 12 + (d.getMonth() - from.getMonth());
  };

  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // is_estimate recurring items are handled entirely below, via the shared
  // step-back rule — never added flatly per month like a plain recurring cost.
  const estimateCategories = new Set(
    items.filter((i) => i.is_estimate && !isOneOff(i)).map((i) => i.category)
  );

  for (let k = 0; k < months; k++) {
    const bucketMonthStart = new Date(from.getFullYear(), from.getMonth() + k, 1);
    const stepBack = stepBackByCategory(items, bucketMonthStart, currentMonthStart);
    for (const [category, r] of Object.entries(stepBack)) {
      add(k, category, r.effective, "recurring");
    }
  }

  for (const item of items) {
    if (isOneOff(item)) {
      // Real spend in an estimate category was already folded into the
      // step-back above (as recurring, not a named one-off — a settled
      // month's step-back `effective` is real category actuals, which reads
      // as the recurring baseline, not a one-off spike) — adding it again
      // here would double-count it.
      if (estimateCategories.has(item.category) && !item.is_estimate && item.amount > 0) continue;
      // FLUX-1575: a one-off with no start_date has no known month to land
      // in — excluding it beats silently folding it into bucket 0 (the
      // current month), which used to make any undated one-off inflate the
      // current month's bar. A dated-but-out-of-window one-off is likewise
      // dropped by `add`'s own range guard rather than clamped to bucket 0.
      if (!item.start_date) continue;
      add(monthIndex(item.start_date), item.category, item.amount, "oneOff", item.name);
    } else if (!item.is_estimate) {
      const monthly = monthlyAmount(item);
      for (let k = 0; k < months; k++) add(k, item.category, monthly, "recurring");
    }
  }

  return buckets;
}

/** Parse a 'YYYY-MM-DD' date-only string as a local-midnight Date (avoids UTC shift). */
export function parseLocalDateOnly(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days between two local-midnight Dates (b - a). */
export function daysBetweenDates(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

const CADENCE_STEP: Record<Exclude<CostCadence, "one_off">, (d: Date) => void> = {
  weekly: (d) => d.setDate(d.getDate() + 7),
  fortnightly: (d) => d.setDate(d.getDate() + 14),
  monthly: (d) => d.setMonth(d.getMonth() + 1),
  quarterly: (d) => d.setMonth(d.getMonth() + 3),
  yearly: (d) => d.setFullYear(d.getFullYear() + 1),
};

/**
 * Next occurrence on/after `from` (compared at local-midnight granularity) for
 * a cost item's cadence — cost items have no due-date field, so bill-due
 * surfaces derive it from `start_date` + `cadence`. One-off → its `start_date`
 * if on/after `from`, else null (already happened). Recurring with no
 * `start_date` → null (no anchor to advance from — undatable). Recurring whose
 * next occurrence would fall after `end_date` (contract ended) → null (FLUX-262).
 */
export function nextOccurrence(
  item: Pick<CostItem, "cadence" | "start_date" | "end_date">,
  from: Date
): Date | null {
  if (!item.start_date) return null;
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const start = parseLocalDateOnly(item.start_date);
  if (item.cadence === "one_off") {
    return start >= fromMidnight ? start : null;
  }
  const occurrence = new Date(start);
  const step = CADENCE_STEP[item.cadence];
  while (occurrence < fromMidnight) step(occurrence);
  if (item.end_date && occurrence > parseLocalDateOnly(item.end_date)) return null;
  return occurrence;
}

export const CADENCE_LABEL: Record<CostCadence, string> = {
  weekly: "/wk",
  fortnightly: "/fortnight",
  monthly: "/mo",
  quarterly: "/qtr",
  yearly: "/yr",
  one_off: "one-off",
};

export const PERIOD_LABEL: Record<Period, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export interface CostSectionSuggestions {
  rent: boolean;
  setup: boolean;
}

/**
 * Costs' "From your other sections" suggestions: weekly rent from the chosen
 * apartment (Home Search) and the Home Setup estimated total. Each one shows
 * while its source has a value and no line already covers it, and only while
 * its feature is on; the caller hides the block when neither shows.
 */
export function costSectionSuggestions(input: {
  items: Pick<CostItem, "linked_section" | "category">[];
  rentWeeklyCents: number;
  setupTotalCents: number;
  // Modules: the rent suggestion needs costs and search; the setup one needs costs and setup (module-features.ts).
  rentEnabled: boolean;
  setupEnabled: boolean;
}): CostSectionSuggestions {
  const { items, rentWeeklyCents, setupTotalCents, rentEnabled, setupEnabled } = input;
  const hasRent = items.some((i) => i.linked_section === "home_search" || i.category === "rent");
  const hasSetup = items.some((i) => i.linked_section === "home_setup");
  return {
    rent: rentEnabled && rentWeeklyCents > 0 && !hasRent,
    setup: setupEnabled && setupTotalCents > 0 && !hasSetup,
  };
}
