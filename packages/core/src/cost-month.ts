// Costs: one month, worked out one way (Guy's redesign, Oct 22). Every total
// the app shows about a month reads from costMonth: the Costs hero and chart,
// the categories list, Home's Budget space, the weekly digest and the
// Assistant. They can't disagree because nothing else adds money up.
//
// What counts:
// - Payments that came in from a source (a bank connector now, a CSV import
//   later), summed per shop and month on the server (ledgerRows). Money out
//   is spent; money back from a shop takes its category down; other money in
//   is income. A payment counts once, whatever cost line it's filed under.
// - Costs added by hand: a one-off on its date, a recurring one on each of
//   its dates at that date's price. Before today that's spent; after, it's to
//   come. An archived cost never counts.
// - In the current month and months ahead: each recurring cost the bank pays
//   that hasn't been paid yet (to come), and what's left of each category's
//   usual shop spend (the last three finished months, the latest counting
//   most).
// A cost line the bank made for a shop (bank_source, one-off) only remembers
// that shop's category: its payments count, its own amount never does.

import { CATEGORY_META, costTargets, isOneOff, EVERYDAY_WEIGHTS } from './costs';
import { occurrencesIn } from './month-spending';
import { costCategoryFromUp } from './up-bank';
import type { CostCategory, CostItem } from './types';

/** One shop's payments in one month, from a payment source. Built on the server from the rows the viewer may see. */
export interface LedgerRow {
  /** YYYY-MM, the viewer's local month. */
  month: string;
  /** The payee as the bank shows it. */
  vendor: string;
  /** The cost line these payments are filed under, if any. */
  costItemId: string | null;
  /** The source's own category, for payments not filed under a line. */
  sourceCategory: string | null;
  /** Money out, positive cents. */
  outCents: number;
  /** Money in (refunds and income), positive cents. */
  inCents: number;
  /** Payments out. */
  count: number;
  /** The latest payment, an instant. */
  lastAt: string;
  /** Where the payments came from. */
  source: 'up' | 'csv';
}

/** A price a recurring cost takes from a date on. */
export interface CostPriceChange {
  /** YYYY-MM-DD. */
  from: string;
  /** Cents. */
  amount: number;
}

/** A cost's price on a date: its latest price change on or before it, else its amount. */
export function costPriceOn(item: Pick<CostItem, 'amount' | 'price_changes'>, date: Date | null): number {
  if (!date || !item.price_changes?.length) return item.amount;
  let price = item.amount;
  let at = '';
  const day = dayKey(date);
  for (const c of item.price_changes) if (c.from <= day && c.from >= at) {
    price = c.amount;
    at = c.from;
  }
  return price;
}

/** A cost's price list with a new price from a date on (replacing one on the same date), oldest first. */
export function withPriceChange(changes: readonly CostPriceChange[], from: string, amount: number): CostPriceChange[] {
  return [...changes.filter((c) => c.from !== from), { from, amount }].sort((a, b) => a.from.localeCompare(b.from));
}

export type CostMonthLineKind =
  /** A shop's payments in the month. */
  | 'shop'
  /** A recurring cost: paid, partly paid or due. */
  | 'recurring'
  /** A cost added by hand: a one-off, or one date of a recurring one the bank doesn't pay. */
  | 'cost'
  /** What's left of the category's usual shop spend. */
  | 'usual'
  /** A hand-made estimate the bank's payments replaced: shown, never counted. */
  | 'target';

export interface CostMonthLine {
  kind: CostMonthLineKind;
  key: string;
  name: string;
  paidCents: number;
  toComeCents: number;
  /** Payments behind a shop or recurring line. */
  count: number;
  /** The latest payment (an instant) or the cost's date (YYYY-MM-DD) or due date. */
  date: string | null;
  /** The cost line behind it, when there is one. */
  item?: CostItem;
  /** Where its money came from: a source, or 'manual' for a cost added by hand. */
  source: 'up' | 'csv' | 'manual' | null;
  /** The shop's name for a drilldown, for kind 'shop'. */
  vendor?: string;
}

export interface CostMonthCategory {
  /** null: payments with no category yet. */
  category: CostCategory | null;
  paidCents: number;
  toComeCents: number;
  lines: CostMonthLine[];
}

export interface CostMonth {
  /** YYYY-MM. */
  month: string;
  when: 'past' | 'current' | 'future';
  paidCents: number;
  toComeCents: number;
  /** paid + to come. */
  expectedCents: number;
  /** Money in so far. */
  incomeCents: number;
  /** What income should reach by month end (at least what came in). Null when there's no income at all. */
  incomeExpectedCents: number | null;
  /** Categories with money in the month, biggest first; income is not among them. */
  categories: CostMonthCategory[];
  /** Money in, as its own category. Null when there's none. */
  income: CostMonthCategory | null;
}

export interface CostMonthInput {
  items: readonly CostItem[];
  /** Imported payments per shop and month (every month the usual-spend average needs). Empty without a source. */
  ledger: readonly LedgerRow[];
  /** YYYY-MM. */
  month: string;
  now?: Date;
  /** Lines a bank rule fits, paid yet or not. */
  linked?: ReadonlySet<string>;
  /** The first whole month the ledger covers (YYYY-MM), null when it covers them all. */
  since?: string | null;
}

const INCOME: CostCategory = 'income';

/** Works out one month. See the file comment for what counts. */
export function costMonth(input: CostMonthInput): CostMonth {
  const { items, ledger, month } = input;
  const now = input.now ?? new Date();
  const currentKey = monthKeyOf(now);
  const when = month < currentKey ? 'past' : month === currentKey ? 'current' : 'future';
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const live = items.filter((i) => !i.deleted);
  const byId = new Map(live.map((i) => [i.id, i]));
  const linked = new Set<string>(input.linked ?? []);
  for (const r of ledger) if (r.costItemId) linked.add(r.costItemId);
  for (const i of live) if (i.bank_source) linked.add(i.id);
  const targets = costTargets(live);
  const counts = (i: CostItem) => !i.archived && !targets.has(i.id);

  // A shop filed under a line in any month keeps that line's category for payments that aren't.
  const vendorCategory = new Map<string, CostCategory>();
  for (const r of ledger) {
    const item = r.costItemId ? byId.get(r.costItemId) : undefined;
    if (item) vendorCategory.set(squash(r.vendor), item.category);
  }
  const categoryOf = (r: LedgerRow): CostCategory | null => {
    const item = r.costItemId ? byId.get(r.costItemId) : undefined;
    if (item) return item.category;
    return vendorCategory.get(squash(r.vendor)) ?? (r.sourceCategory ? costCategoryFromUp(r.sourceCategory) : null);
  };
  const recurringLine = (r: LedgerRow) => {
    const item = r.costItemId ? byId.get(r.costItemId) : undefined;
    return item && !isOneOff(item) ? item : undefined;
  };

  const cats = new Map<CostCategory | null, CostMonthCategory>();
  const lineIn = (category: CostCategory | null, key: string, make: () => CostMonthLine): CostMonthLine => {
    const c = cats.get(category) ?? { category, paidCents: 0, toComeCents: 0, lines: [] };
    cats.set(category, c);
    let line = c.lines.find((l) => l.key === key);
    if (!line) {
      line = make();
      c.lines.push(line);
    }
    return line;
  };

  // Imported payments.
  const shopPaid: Record<string, number> = {};
  for (const r of ledger) {
    if (r.month !== month) continue;
    const category = categoryOf(r);
    const rec = recurringLine(r);
    const net = r.outCents - (category === INCOME ? 0 : r.inCents);
    const incomeIn = category === INCOME ? r.inCents : r.outCents === 0 && r.inCents > 0 && category === null ? r.inCents : 0;
    if (incomeIn > 0 && net <= 0) {
      const line = lineIn(INCOME, `in:${squash(r.vendor)}`, () => ({ kind: 'shop', key: `in:${squash(r.vendor)}`, name: r.vendor, paidCents: 0, toComeCents: 0, count: 0, date: null, source: r.source, vendor: r.vendor }));
      line.paidCents += incomeIn;
      line.count += 1;
      line.date = later(line.date, r.lastAt);
      continue;
    }
    if (net === 0) continue;
    const key = rec ? `r:${rec.id}` : `s:${squash(r.vendor)}`;
    const line = lineIn(category, key, () =>
      rec
        ? { kind: 'recurring', key, name: rec.name, paidCents: 0, toComeCents: 0, count: 0, date: null, item: rec, source: r.source }
        : { kind: 'shop', key, name: r.vendor, paidCents: 0, toComeCents: 0, count: 0, date: null, source: r.source, vendor: r.vendor, item: r.costItemId ? byId.get(r.costItemId) : undefined },
    );
    line.paidCents += net;
    line.count += r.count;
    line.date = later(line.date, r.lastAt);
    if (!rec && category) shopPaid[category] = (shopPaid[category] ?? 0) + net;
  }

  for (const item of live) {
    if (targets.has(item.id)) {
      if (occurrencesIn(item, start, end).length) {
        lineIn(item.category, `t:${item.id}`, () => ({ kind: 'target', key: `t:${item.id}`, name: item.name, paidCents: 0, toComeCents: 0, count: 0, date: null, item, source: 'manual' }));
      }
      continue;
    }
    if (!counts(item)) continue;
    if (linked.has(item.id)) {
      // The bank pays it: what it should take this month, less what came out.
      if (isOneOff(item) || when === 'past') continue;
      const dates = occurrencesIn(item, start, end);
      const due = dates.reduce((s, d) => s + costPriceOn(item, d), 0);
      const key = `r:${item.id}`;
      const line = lineIn(item.category, key, () => ({ kind: 'recurring', key, name: item.name, paidCents: 0, toComeCents: 0, count: 0, date: null, item, source: 'up' }));
      line.toComeCents = Math.max(0, due - line.paidCents);
      if (line.toComeCents > 0) {
        const next = dates.find((d) => d && d >= today) ?? dates[dates.length - 1] ?? null;
        if (!line.paidCents && next) line.date = dayKey(next);
      }
      continue;
    }
    // Added by hand: each date in the month, spent once it's passed.
    occurrencesIn(item, start, end).forEach((d, n) => {
      const cents = costPriceOn(item, d);
      if (cents <= 0) return;
      const passed = when === 'past' || (when === 'current' && (!d || d <= today));
      const key = `c:${item.id}:${n}`;
      lineIn(item.category, key, () => ({
        kind: 'cost',
        key,
        name: item.name,
        paidCents: passed ? cents : 0,
        toComeCents: passed ? 0 : cents,
        count: 0,
        date: d ? dayKey(d) : null,
        item,
        source: 'manual',
      }));
    });
  }

  // Each category's usual shop spend, from finished months the ledger covers.
  if (when !== 'past' && ledger.length) {
    for (const [category, usual] of Object.entries(usualShopSpend(input, categoryOf, recurringLine, now)) as [CostCategory, number][]) {
      const left = usual - (when === 'current' ? (shopPaid[category] ?? 0) : 0);
      if (left <= 0) continue;
      const key = `u:${category}`;
      lineIn(category, key, () => ({ kind: 'usual', key, name: 'Usual spend', paidCents: 0, toComeCents: left, count: 0, date: null, source: null }));
    }
  }

  for (const c of cats.values()) {
    c.paidCents = c.lines.reduce((s, l) => s + l.paidCents, 0);
    c.toComeCents = c.lines.reduce((s, l) => s + l.toComeCents, 0);
    const rank = (l: CostMonthLine) => (l.kind === 'usual' ? 3 : l.kind === 'target' ? 4 : l.paidCents > 0 ? 0 : 1);
    c.lines.sort((a, b) => rank(a) - rank(b) || b.paidCents + b.toComeCents - (a.paidCents + a.toComeCents) || a.name.localeCompare(b.name));
  }
  const income = cats.get(INCOME) ?? null;
  cats.delete(INCOME);
  const categories = [...cats.values()]
    .filter((c) => c.lines.length)
    .sort((a, b) => (a.category === null ? -1 : b.category === null ? 1 : b.paidCents + b.toComeCents - (a.paidCents + a.toComeCents)));
  const paidCents = categories.reduce((s, c) => s + c.paidCents, 0);
  const toComeCents = categories.reduce((s, c) => s + c.toComeCents, 0);

  const incomeCents = income?.paidCents ?? 0;
  const incomePlanned = income?.toComeCents ?? 0;
  let incomeExpectedCents: number | null = income ? incomeCents + incomePlanned : null;
  if (when !== 'past' && ledger.length) {
    const regular = regularIncomeToCome(input, categoryOf, now);
    if (regular > 0) incomeExpectedCents = (incomeExpectedCents ?? 0) + regular;
  }

  return { month, when, paidCents, toComeCents, expectedCents: paidCents + toComeCents, incomeCents, incomeExpectedCents, categories, income };
}

/** The finished months an average looks at, latest first, with their weights. */
function averageMonths(since: string | null | undefined, now: Date): { key: string; weight: number }[] {
  return EVERYDAY_WEIGHTS.map((weight, n) => ({ key: monthKeyOf(new Date(now.getFullYear(), now.getMonth() - 1 - n, 1)), weight })).filter(
    (m) => !since || m.key >= since,
  );
}

function usualShopSpend(
  input: CostMonthInput,
  categoryOf: (r: LedgerRow) => CostCategory | null,
  recurringLine: (r: LedgerRow) => CostItem | undefined,
  now: Date,
): Record<string, number> {
  const months = averageMonths(input.since, now);
  const weights = months.reduce((s, m) => s + m.weight, 0);
  const out: Record<string, number> = {};
  if (!weights) return out;
  const weightOf = new Map(months.map((m) => [m.key, m.weight]));
  for (const r of input.ledger) {
    const w = weightOf.get(r.month);
    if (!w || recurringLine(r)) continue;
    const category = categoryOf(r);
    if (!category || category === INCOME) continue;
    out[category] = (out[category] ?? 0) + w * (r.outCents - r.inCents);
  }
  for (const k of Object.keys(out)) out[k] = Math.max(0, Math.round(out[k] / weights));
  return out;
}

/**
 * Income still expected this month from regular payers only: a payer that
 * paid in at least two of the averaged months is expected again at its
 * typical (median) monthly amount, less what it has paid this month. A one-off
 * deposit (a lump sum moved in from savings, a gift) never sets what a month
 * should bring in.
 */
function regularIncomeToCome(input: CostMonthInput, categoryOf: (r: LedgerRow) => CostCategory | null, now: Date): number {
  const months = new Set(averageMonths(input.since, now).map((m) => m.key));
  if (months.size < 2) return 0;
  const isIncome = (r: LedgerRow) => {
    const category = categoryOf(r);
    return category === INCOME || (category === null && r.outCents === 0 && r.inCents > 0);
  };
  const past = new Map<string, Map<string, number>>();
  const thisMonth = new Map<string, number>();
  for (const r of input.ledger) {
    if (!isIncome(r)) continue;
    const key = squash(r.vendor);
    if (r.month === input.month) thisMonth.set(key, (thisMonth.get(key) ?? 0) + r.inCents);
    else if (months.has(r.month)) {
      const byMonth = past.get(key) ?? new Map<string, number>();
      byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.inCents);
      past.set(key, byMonth);
    }
  }
  let toCome = 0;
  for (const [key, byMonth] of past) {
    if (byMonth.size < 2) continue;
    const typical = median([...byMonth.values()]);
    toCome += Math.max(0, typical - (thisMonth.get(key) ?? 0));
  }
  return toCome;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** A run of months, for the chart: each one worked out by costMonth. */
export function costMonths(input: Omit<CostMonthInput, 'month'>, months: readonly string[]): CostMonth[] {
  return months.map((month) => costMonth({ ...input, month }));
}

/** The YYYY-MM keys of `count` months starting `offset` months from `now`'s. */
export function monthKeys(now: Date, offset: number, count: number): string[] {
  return Array.from({ length: count }, (_, k) => monthKeyOf(new Date(now.getFullYear(), now.getMonth() + offset + k, 1)));
}

/** A category's label, or "Pick a category" for payments without one. */
export function costCategoryLabel(category: CostCategory | null): string {
  return category ? CATEGORY_META[category].label : 'Pick a category';
}

function squash(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toUpperCase();
}

function later(a: string | null, b: string): string {
  return !a || b > a ? b : a;
}

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

