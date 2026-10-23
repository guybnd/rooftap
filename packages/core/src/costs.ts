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
  transport: { label: "Transport", color: "bg-indigo-900/40 text-indigo-300" },
  health: { label: "Health", color: "bg-teal-900/40 text-teal-300" },
  pets: { label: "Pets", color: "bg-emerald-900/40 text-emerald-300" },
  family: { label: "Kids and family", color: "bg-rose-900/40 text-rose-300" },
  other: { label: "Other", color: "bg-slate-700 text-slate-300" },
  income: { label: "Income", color: "bg-emerald-900/40 text-emerald-300" },
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
// One swatch holds on both grounds (Hearth §3, chart series). The fills are
// pastel (Guy, 2026-10-22) so the category reads as content, not alarm;
// `text` and `tile` (the row glyph and the group title) darken on a light
// ground so they stay legible.
export const CATEGORY_COLOR: Record<
  CostCategory,
  { fill: string; border: string; dot: string; text: string; tile: string }
> = {
  rent: { fill: "bg-blue-300 cat-idx-0", border: "border-l-blue-300/60 cat-idx-0", dot: "bg-blue-300 cat-idx-0", text: "text-blue-600 dark:text-blue-200 cat-idx-0", tile: "bg-blue-300/20 text-blue-700 dark:bg-blue-300/15 dark:text-blue-200 cat-idx-0" },
  utilities: { fill: "bg-amber-200 cat-idx-1", border: "border-l-amber-200/60 cat-idx-1", dot: "bg-amber-200 cat-idx-1", text: "text-amber-600 dark:text-amber-100 cat-idx-1", tile: "bg-amber-200/20 text-amber-700 dark:bg-amber-200/15 dark:text-amber-100 cat-idx-1" },
  internet: { fill: "bg-cyan-300 cat-idx-2", border: "border-l-cyan-300/60 cat-idx-2", dot: "bg-cyan-300 cat-idx-2", text: "text-cyan-600 dark:text-cyan-200 cat-idx-2", tile: "bg-cyan-300/20 text-cyan-700 dark:bg-cyan-300/15 dark:text-cyan-200 cat-idx-2" },
  insurance: { fill: "bg-violet-300 cat-idx-3", border: "border-l-violet-300/60 cat-idx-3", dot: "bg-violet-300 cat-idx-3", text: "text-violet-600 dark:text-violet-200 cat-idx-3", tile: "bg-violet-300/20 text-violet-700 dark:bg-violet-300/15 dark:text-violet-200 cat-idx-3" },
  subscription: { fill: "bg-pink-300 cat-idx-4", border: "border-l-pink-300/60 cat-idx-4", dot: "bg-pink-300 cat-idx-4", text: "text-pink-600 dark:text-pink-200 cat-idx-4", tile: "bg-pink-300/20 text-pink-700 dark:bg-pink-300/15 dark:text-pink-200 cat-idx-4" },
  grocery_estimate: { fill: "bg-lime-200 cat-idx-5", border: "border-l-lime-200/60 cat-idx-5", dot: "bg-lime-200 cat-idx-5", text: "text-lime-600 dark:text-lime-100 cat-idx-5", tile: "bg-lime-200/20 text-lime-700 dark:bg-lime-200/15 dark:text-lime-100 cat-idx-5" },
  moving: { fill: "bg-orange-300 cat-idx-6", border: "border-l-orange-300/60 cat-idx-6", dot: "bg-orange-300 cat-idx-6", text: "text-orange-600 dark:text-orange-200 cat-idx-6", tile: "bg-orange-300/20 text-orange-700 dark:bg-orange-300/15 dark:text-orange-200 cat-idx-6" },
  purchase: { fill: "bg-fuchsia-300 cat-idx-7", border: "border-l-fuchsia-300/60 cat-idx-7", dot: "bg-fuchsia-300 cat-idx-7", text: "text-fuchsia-600 dark:text-fuchsia-200 cat-idx-7", tile: "bg-fuchsia-300/20 text-fuchsia-700 dark:bg-fuchsia-300/15 dark:text-fuchsia-200 cat-idx-7" },
  outing: { fill: "bg-sky-200 cat-idx-8", border: "border-l-sky-200/60 cat-idx-8", dot: "bg-sky-200 cat-idx-8", text: "text-sky-600 dark:text-sky-100 cat-idx-8", tile: "bg-sky-200/20 text-sky-700 dark:bg-sky-200/15 dark:text-sky-100 cat-idx-8" },
  transport: { fill: "bg-indigo-300 cat-idx-9", border: "border-l-indigo-300/60 cat-idx-9", dot: "bg-indigo-300 cat-idx-9", text: "text-indigo-600 dark:text-indigo-200 cat-idx-9", tile: "bg-indigo-300/20 text-indigo-700 dark:bg-indigo-300/15 dark:text-indigo-200 cat-idx-9" },
  health: { fill: "bg-teal-300 cat-idx-10", border: "border-l-teal-300/60 cat-idx-10", dot: "bg-teal-300 cat-idx-10", text: "text-teal-600 dark:text-teal-200 cat-idx-10", tile: "bg-teal-300/20 text-teal-700 dark:bg-teal-300/15 dark:text-teal-200 cat-idx-10" },
  pets: { fill: "bg-emerald-200 cat-idx-11", border: "border-l-emerald-200/60 cat-idx-11", dot: "bg-emerald-200 cat-idx-11", text: "text-emerald-600 dark:text-emerald-100 cat-idx-11", tile: "bg-emerald-200/20 text-emerald-700 dark:bg-emerald-200/15 dark:text-emerald-100 cat-idx-11" },
  family: { fill: "bg-rose-200 cat-idx-12", border: "border-l-rose-200/60 cat-idx-12", dot: "bg-rose-200 cat-idx-12", text: "text-rose-600 dark:text-rose-100 cat-idx-12", tile: "bg-rose-200/20 text-rose-700 dark:bg-rose-200/15 dark:text-rose-100 cat-idx-12" },
  other: { fill: "bg-slate-400 cat-idx-13", border: "border-l-slate-400/60 cat-idx-13", dot: "bg-slate-400 cat-idx-13", text: "text-slate-600 dark:text-slate-300 cat-idx-13", tile: "bg-slate-400/20 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300 cat-idx-13" },
  income: { fill: "bg-green-400 cat-idx-14", border: "border-l-green-400/60 cat-idx-14", dot: "bg-green-400 cat-idx-14", text: "text-green-700 dark:text-green-300 cat-idx-14", tile: "bg-green-400/20 text-green-700 dark:bg-green-400/15 dark:text-green-300 cat-idx-14" },
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
export function monthlyProjection(
  items: CostItem[],
  from: Date,
  months = 12,
  now: Date = new Date(),
  bank?: BankActuals
): MonthBucket[] {
  // Lines linked to bank payments count what was really paid in a finished
  // month the bank data covers. A recurring one counts at least its plan in
  // the current month and its plan after that. A one-off line the bank made
  // for a shop holds only what was paid: months ahead get each category's
  // usual everyday spend instead (everydayAverage), and the current month
  // gets whatever of that hasn't been spent yet.
  const linked = bank ? items.filter((i) => bank.linked.has(i.id)) : [];
  if (linked.length) {
    const rest = items.filter((i) => !linked.includes(i));
    const buckets = monthlyProjection(rest, from, months, now);
    const currentKey = monthKeyOf(now);
    const usual = everydayAverage(items, bank!, now);
    for (let k = 0; k < months; k++) {
      const key = monthKeyOf(new Date(from.getFullYear(), from.getMonth() + k, 1));
      const covered = !bank!.since || key >= bank!.since;
      const add = (category: string, amount: number) => {
        if (amount <= 0) return;
        buckets[k].byCategory[category] = (buckets[k].byCategory[category] ?? 0) + amount;
        buckets[k].total += amount;
        buckets[k].recurring += amount;
      };
      const everydayPaid: Record<string, number> = {};
      for (const item of linked) {
        const paid = bank!.byItem.get(item.id)?.get(key) ?? 0;
        if (isOneOff(item)) {
          const own = item.start_date && monthKeyOf(parseLocalDateOnly(item.start_date)) === key ? item.amount : 0;
          const amount = key > currentKey ? 0 : covered ? paid : own;
          everydayPaid[item.category] = (everydayPaid[item.category] ?? 0) + amount;
          add(item.category, amount);
          continue;
        }
        const plan = monthlyAmount(item);
        add(item.category, key < currentKey ? (covered ? paid : plan) : key === currentKey ? Math.max(plan, paid) : plan);
      }
      if (key >= currentKey) {
        for (const [category, cents] of Object.entries(usual)) add(category, cents - (everydayPaid[category] ?? 0));
      }
    }
    return buckets;
  }

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

/** Real bank spend per cost line, for monthlyProjection (from core up-bank's costActuals). */
export interface BankActuals {
  /** Lines linked to bank payments: a rule, or payments filed by hand. */
  linked: ReadonlySet<string>;
  /** Spend per line, then per YYYY-MM month. */
  byItem: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** The first whole month the bank data covers; null when it covers them all. */
  since: string | null;
}

/** How many finished months everydayAverage looks back over, latest first, and how much each counts. */
export const EVERYDAY_WEIGHTS = [3, 2, 1] as const;

/**
 * A category's usual monthly everyday spend: what its bank-made one-off lines
 * (shops, cafes, one-time buys) took in each of the last three finished
 * months the bank data covers, the latest counting most. Bills and other
 * recurring lines plan for themselves, so they stay out.
 */
export function everydayAverage(items: readonly CostItem[], bank: BankActuals, now: Date = new Date()): Record<string, number> {
  const lines = items.filter((i) => !i.deleted && isOneOff(i) && bank.linked.has(i.id));
  const sums: Record<string, number> = {};
  let weights = 0;
  EVERYDAY_WEIGHTS.forEach((weight, n) => {
    const key = monthKeyOf(new Date(now.getFullYear(), now.getMonth() - 1 - n, 1));
    if (bank.since && key < bank.since) return;
    weights += weight;
    for (const item of lines) {
      const paid = bank.byItem.get(item.id)?.get(key) ?? 0;
      if (paid > 0) sums[item.category] = (sums[item.category] ?? 0) + weight * paid;
    }
  });
  const out: Record<string, number> = {};
  if (!weights) return out;
  for (const [category, sum] of Object.entries(sums)) out[category] = Math.round(sum / weights);
  return out;
}

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Hand-made estimates that became targets: a recurring estimate in a category
 * where the bank now files real payments under vendor lines (bank_source).
 * They stay on the list as the category's target but leave the totals, so
 * nothing counts twice.
 */
export function costTargets(items: readonly CostItem[]): Set<string> {
  const filed = new Set(items.filter((i) => !i.deleted && i.bank_source).map((i) => i.category));
  return new Set(
    items.filter((i) => !i.deleted && !i.bank_source && i.is_estimate && !isOneOff(i) && filed.has(i.category)).map((i) => i.id)
  );
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
