// Costs by month (Guy's pick "Both, with a switch"): what a month really
// took, payment by payment, each under a category, and what a month ahead
// should take. A finished or current month comes from the bank's payments;
// a month ahead is the bills that repeat, each category's usual everyday
// spend (costs everydayAverage) and the one-offs planned for it.
// monthBook (Guy's pick A) puts a month in one list: payments on their day,
// hand-made lines on their date, and ghosts (estimates, bills not paid yet,
// the rest of a category's usual spend) that drop off once payments land.
// Platform-agnostic: both apps' Costs screens read these.

import { CATEGORY_META, everydayAverage, isOneOff, monthlyAmount, nextOccurrence, parseLocalDateOnly, type BankActuals } from './costs';
import { isBill } from './money-insights';
import { billsDue, type BillDue } from './money-insights';
import { costCategoryFromUp, type CostBankLink, type SpendingTransaction } from './up-bank';
import type { CostCategory, CostItem } from './types';

/**
 * A payment's category: its cost line's, else the closest fit to Up's own
 * category, else null (nothing to go on, so the person picks one).
 */
export function paymentCategory(
  t: Pick<SpendingTransaction, 'category' | 'costItemId'>,
  itemById: ReadonlyMap<string, Pick<CostItem, 'category'>>,
): CostCategory | null {
  const line = t.costItemId ? itemById.get(t.costItemId) : undefined;
  if (line) return line.category;
  return t.category ? costCategoryFromUp(t.category) : null;
}

/** A spending payment's category label, or null for money in and transfers. */
export function paymentCategoryLabel(
  t: Pick<SpendingTransaction, 'amountCents' | 'category' | 'costItemId'> & { isTransfer?: boolean },
  itemById: ReadonlyMap<string, Pick<CostItem, 'category'>>,
): string | null {
  if (t.isTransfer || t.amountCents > 0) return null;
  const c = paymentCategory(t, itemById);
  return c ? CATEGORY_META[c]?.label ?? null : null;
}

/** Money that went out to someone: not money in, a transfer, or a payment hidden from spending. */
export function isSpending(t: { amountCents: number; isTransfer?: boolean; hidden?: boolean }): boolean {
  return t.amountCents < 0 && !t.isTransfer && !t.hidden;
}

/** Which way a payment went, for the Money view's filter. */
export type PaymentDirection = 'all' | 'out' | 'in';

export function paymentGoes(t: { amountCents: number }, direction: PaymentDirection): boolean {
  if (direction === 'out') return t.amountCents < 0;
  if (direction === 'in') return t.amountCents > 0;
  return true;
}

export interface CategorySpend<T> {
  /** null: payments with no category yet. */
  category: CostCategory | null;
  cents: number;
  payments: T[];
}

/** A month's spending by category, biggest first, payments with no category last. Payments keep their order. */
export function spendingByCategory<T extends Pick<SpendingTransaction, 'amountCents' | 'category' | 'costItemId'> & { isTransfer?: boolean; hidden?: boolean }>(
  rows: readonly T[],
  itemById: ReadonlyMap<string, Pick<CostItem, 'category'>>,
): CategorySpend<T>[] {
  const by = new Map<CostCategory | null, CategorySpend<T>>();
  for (const t of rows) {
    if (!isSpending(t)) continue;
    const category = paymentCategory(t, itemById);
    const entry = by.get(category) ?? { category, cents: 0, payments: [] };
    entry.cents += -t.amountCents;
    entry.payments.push(t);
    by.set(category, entry);
  }
  return [...by.values()].sort((a, b) => (a.category === null ? 1 : b.category === null ? -1 : b.cents - a.cents));
}

/**
 * Bills still to come this month: due from today to the month's end and not
 * paid yet. A bill the bank pays is due a cadence after its last payment, so
 * one paid this month drops off by itself.
 */
export function stillToCome(items: readonly CostItem[], links: readonly CostBankLink[], now: Date = new Date()): BillDue[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const days = Math.round((monthEnd.getTime() - today.getTime()) / 86_400_000);
  return billsDue(items, links, now, days);
}

export interface MonthOutlook {
  /** Lines that repeat, at their monthly amount, biggest first. */
  bills: { item: CostItem; cents: number }[];
  /** Each category's usual everyday spend, biggest first. */
  everyday: { category: CostCategory; cents: number }[];
  /** One-offs the household planned for the month. */
  planned: CostItem[];
  billsCents: number;
  everydayCents: number;
  totalCents: number;
}

/**
 * What a month ahead should take. `items` are the lines that count (targets
 * left out); `month` is YYYY-MM. Without bank data there is no everyday
 * part, and the repeating lines carry the forecast.
 */
export function monthOutlook(items: readonly CostItem[], bank: BankActuals | undefined, month: string, now: Date = new Date()): MonthOutlook {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const bills = items
    .filter((i) => !i.deleted && !isOneOff(i) && !(i.end_date && parseLocalDateOnly(i.end_date) < start))
    .map((item) => ({ item, cents: Math.round(monthlyAmount(item)) }))
    .filter((b) => b.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.item.name.localeCompare(b.item.name));
  const everyday = bank
    ? (Object.entries(everydayAverage(items, bank, now)) as [CostCategory, number][])
        .map(([category, cents]) => ({ category, cents }))
        .filter((e) => e.cents > 0)
        .sort((a, b) => b.cents - a.cents)
    : [];
  const planned = items.filter(
    (i) => !i.deleted && isOneOff(i) && !bank?.linked.has(i.id) && !!i.start_date && i.start_date.slice(0, 7) === month && i.amount > 0,
  );
  const billsCents = bills.reduce((s, b) => s + b.cents, 0);
  const everydayCents = everyday.reduce((s, e) => s + e.cents, 0);
  const plannedCents = planned.reduce((s, i) => s + i.amount, 0);
  return { bills, everyday, planned, billsCents, everydayCents, totalCents: billsCents + everydayCents + plannedCents };
}

// ── One list for a month (pick A) ────────────────────────────────────────

/** One row of a month's list. `expected` and `usual` are ghosts: they don't count as spent. */
export type MonthEntry<T> =
  | { kind: 'payment'; key: string; date: Date; cents: number; payment: T }
  /** A hand-made line on its date in the month. */
  | { kind: 'line'; key: string; date: Date | null; cents: number; item: CostItem }
  /** An estimate, or a bill the bank pays that hasn't come out yet. */
  | { kind: 'expected'; key: string; date: Date | null; cents: number; item: CostItem }
  /** What's left of a category's usual everyday spend this month. */
  | { kind: 'usual'; key: string; date: null; cents: number; category: CostCategory };

export interface MonthCategory<T> {
  category: CostCategory | null;
  spentCents: number;
  expectedCents: number;
  entries: MonthEntry<T>[];
}

export interface MonthBook<T> {
  categories: MonthCategory<T>[];
  spentCents: number;
  expectedCents: number;
}

type BookPayment = Pick<SpendingTransaction, 'id' | 'amountCents' | 'category' | 'costItemId' | 'occurredAt'> & {
  isTransfer?: boolean;
  hidden?: boolean;
};

const DAY_MS = 86_400_000;

/** A line's dates inside [start, end]: each occurrence, or one undated entry for a recurring line with no start date. */
export function occurrencesIn(item: CostItem, start: Date, end: Date): (Date | null)[] {
  if (isOneOff(item)) {
    if (!item.start_date) return [];
    const d = parseLocalDateOnly(item.start_date);
    return d >= start && d <= end ? [d] : [];
  }
  if (!item.start_date) return [null];
  const out: Date[] = [];
  let from = start;
  for (let n = 0; n < 6; n++) {
    const d = nextOccurrence(item, from);
    if (!d || d > end) break;
    out.push(d);
    from = new Date(d.getTime() + DAY_MS);
  }
  return out;
}

/**
 * A finished or current month as one list, by category. Payments (money out,
 * not transfers or hidden) sit under their category on their day. Lines the
 * household made by hand and the bank doesn't pay sit on their date: a fixed
 * one counts as spent, an estimate is a ghost. In the current month, bills
 * the bank pays that haven't come out yet and what's left of each category's
 * usual everyday spend are ghosts too, and they shrink or drop off as
 * payments land. `items` are the lines that count (targets left out);
 * `itemById` finds any payment's line. `month` is YYYY-MM.
 */
export function monthBook<T extends BookPayment>(input: {
  rows: readonly T[];
  items: readonly CostItem[];
  itemById: ReadonlyMap<string, Pick<CostItem, 'category'>>;
  links: readonly CostBankLink[];
  bank: BankActuals | undefined;
  month: string;
  now?: Date;
}): MonthBook<T> {
  const { rows, items, itemById, links, bank, month } = input;
  const now = input.now ?? new Date();
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const current = month === currentKey;
  const past = month < currentKey;
  const linked = (i: CostItem) => !!i.bank_source || !!bank?.linked.has(i.id);

  const by = new Map<CostCategory | null, MonthCategory<T>>();
  const add = (category: CostCategory | null, e: MonthEntry<T>) => {
    if (e.cents <= 0) return;
    const c = by.get(category) ?? { category, spentCents: 0, expectedCents: 0, entries: [] };
    if (e.kind === 'payment' || e.kind === 'line') c.spentCents += e.cents;
    else c.expectedCents += e.cents;
    c.entries.push(e);
    by.set(category, c);
  };

  const everydayPaid: Record<string, number> = {};
  for (const t of rows) {
    if (!isSpending(t)) continue;
    const category = paymentCategory(t, itemById);
    add(category, { kind: 'payment', key: `p:${t.id}`, date: new Date(t.occurredAt), cents: -t.amountCents, payment: t });
  }

  for (const item of items) {
    if (item.deleted) continue;
    if (!linked(item)) {
      // An estimate in a finished month the bank covers says nothing new.
      if (item.is_estimate && past) continue;
      occurrencesIn(item, start, end).forEach((date, n) => {
        const key = `${item.is_estimate ? 'e' : 'l'}:${item.id}:${n}`;
        if (item.is_estimate) add(item.category, { kind: 'expected', key, date, cents: item.amount, item });
        else add(item.category, { kind: 'line', key, date, cents: item.amount, item });
      });
      continue;
    }
    if (!current || isOneOff(item)) {
      if (isOneOff(item)) everydayPaid[item.category] = (everydayPaid[item.category] ?? 0) + (bank?.byItem.get(item.id)?.get(month) ?? 0);
      continue;
    }
    if (isBill(item)) continue; // stillToCome below
    // A regular line the bank pays whose amount varies (a weekly shop): the rest of its plan.
    const left = Math.round(monthlyAmount(item)) - (bank?.byItem.get(item.id)?.get(month) ?? 0);
    add(item.category, { kind: 'expected', key: `r:${item.id}`, date: null, cents: left, item });
  }

  if (current) {
    for (const b of stillToCome(items.filter(linked), links, now)) {
      add(b.item.category, { kind: 'expected', key: `b:${b.item.id}`, date: b.due, cents: b.amountCents, item: b.item });
    }
    if (bank) {
      for (const [category, usual] of Object.entries(everydayAverage(items, bank, now)) as [CostCategory, number][]) {
        add(category, { kind: 'usual', key: `u:${category}`, date: null, cents: usual - (everydayPaid[category] ?? 0), category });
      }
    }
  }

  const rank = (e: MonthEntry<T>) => (e.kind === 'payment' || e.kind === 'line' ? 0 : e.kind === 'expected' ? 1 : 2);
  const time = (e: MonthEntry<T>) => e.date?.getTime() ?? Number.MAX_SAFE_INTEGER;
  for (const c of by.values()) {
    c.entries.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? time(b) - time(a) : time(a) - time(b)));
  }
  const categories = [...by.values()].sort((a, b) =>
    a.category === null ? 1 : b.category === null ? -1 : b.spentCents + b.expectedCents - (a.spentCents + a.expectedCents),
  );
  return {
    categories,
    spentCents: categories.reduce((s, c) => s + c.spentCents, 0),
    expectedCents: categories.reduce((s, c) => s + c.expectedCents, 0),
  };
}
