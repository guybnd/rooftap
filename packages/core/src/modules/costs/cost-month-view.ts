// What both apps' Costs and Money screens show for a month, read off a
// CostMonth (cost-month.ts): the income tiles, the chart bars, a line's second
// row, a payment's row and the month and day labels. The screens only lay
// these out, so web (apps/web/src/app/costs) and the phone
// (apps/mobile/src/features/costs) can't drift apart.

import { CATEGORY_META } from './costs';
import { formatMoney } from '../../money-format';
import { costCategoryLabel, type CostMonth, type CostMonthLine } from './cost-month';
import { bankDayLabel, bankMatchParts, type BankTransactionView } from './up-bank';
import type { CostCategory, CostItem } from '../../types';

export interface MoneyFlow {
  incomeLabel: string;
  income: number;
  incomeHint?: string;
  leftLabel: string;
  left: number;
  leftHint?: string;
}

/**
 * The income and "in vs out" tiles: what actually came in and went out, with
 * the month-end estimate as the subtitle. A future month has no actuals, so
 * it shows the estimate itself.
 */
export function moneyFlow(month: CostMonth): MoneyFlow | null {
  const expected = month.incomeExpectedCents;
  if (expected == null) return null;
  if (month.when === 'future') {
    return { incomeLabel: 'Expected income', income: expected, leftLabel: 'Expected left', left: expected - month.expectedCents };
  }
  const left = month.incomeCents - month.paidCents;
  if (month.when === 'past') return { incomeLabel: 'Income', income: month.incomeCents, leftLabel: 'Left over', left };
  return {
    incomeLabel: 'Income so far',
    income: month.incomeCents,
    incomeHint: expected > month.incomeCents ? `About ${formatMoney(expected)} expected` : undefined,
    leftLabel: 'In vs out so far',
    left,
    leftHint: `About ${signedMoney(expected - month.expectedCents)} by month end`,
  };
}

const CATEGORY_ORDER = Object.keys(CATEGORY_META) as CostCategory[];

export interface BarSegment {
  key: string;
  category: CostCategory | null;
  cents: number;
  label: string;
  /** 0 for a category; a line's place in its category, for its shade. */
  shade: number;
}

/** A category's key in the chart and the open-category state: its id, or 'none'. */
export function costCategoryKey(category: CostCategory | null): string {
  return category ?? 'none';
}

/**
 * A month's chart bar: paid split by category (in a fixed order, so colours
 * line up month to month) and what's to come. With a category picked, its
 * shops and costs instead, each in a shade of the category's colour, in the
 * order `lineRank` gives (biggest over the chart first).
 */
export function monthBar(m: CostMonth, focus: string | null, lineRank: ReadonlyMap<string, number>): { paid: number; toCome: number; segments: BarSegment[] } {
  const cats = m.categories.filter((c) => !focus || costCategoryKey(c.category) === focus);
  const toCome = focus ? cats.reduce((s, c) => s + c.toComeCents, 0) : m.toComeCents;
  if (focus) {
    const c = cats[0];
    const segments = (c?.lines ?? [])
      .filter((l) => l.paidCents > 0)
      .sort((a, b) => (lineRank.get(a.key) ?? 99) - (lineRank.get(b.key) ?? 99))
      .map((l) => ({ key: l.key, category: c.category, cents: l.paidCents, label: l.name, shade: lineRank.get(l.key) ?? 0 }));
    return { paid: c?.paidCents ?? 0, toCome, segments };
  }
  const rank = (c: CostCategory | null) => (c ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
  const segments = cats
    .filter((c) => c.paidCents > 0)
    .sort((a, b) => rank(a.category) - rank(b.category))
    .map((c) => ({ key: costCategoryKey(c.category), category: c.category, cents: c.paidCents, label: costCategoryLabel(c.category), shade: 0 }));
  return { paid: segments.reduce((s, x) => s + x.cents, 0), toCome, segments };
}

/** A picked category's lines ranked by what they paid over the chart, biggest first. */
export function lineRanks(months: CostMonth[], focus: string | null): Map<string, number> {
  const totals = new Map<string, number>();
  if (focus) {
    for (const m of months) {
      for (const l of m.categories.find((c) => costCategoryKey(c.category) === focus)?.lines ?? []) totals.set(l.key, (totals.get(l.key) ?? 0) + l.paidCents);
    }
  }
  return new Map([...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k], i) => [k, i]));
}

/** A line's second row: "5 payments · last Tue", "Paid Oct 1", "Due Oct 28", "Usual for the rest of October". */
export function lineMeta(l: CostMonthLine, name: string, now: Date = new Date()): string | null {
  if (l.kind === 'usual') return `Usual for the rest of ${name}`;
  if (l.kind === 'target') return 'A plan the payments replaced, not counted';
  if (l.kind === 'shop') return `${l.count} payment${l.count === 1 ? '' : 's'}${l.date ? ` · last ${bankDayLabel(l.date, now)}` : ''}`;
  if (l.kind === 'recurring') {
    if (l.paidCents > 0) return `Paid ${l.date ? costDayLabel(l.date) : ''}`.trim();
    return l.date ? `Due ${costDayLabel(l.date)}` : 'Due';
  }
  if (l.item?.archived) return 'Archived';
  return l.date ? costDayLabel(l.date) : null;
}

/** A payment's second row in the Money view: "Pending · Groceries · line Coles · note · Guy". */
export function bankRowMeta(t: BankTransactionView, line: CostItem | null, categoryLabel: string | null, owner: string | null): string {
  return [
    t.pending ? 'Pending' : null,
    t.isTransfer ? 'Transfer' : t.amountCents > 0 ? 'Money in' : categoryLabel ?? 'No category yet',
    line ? `line ${line.name}` : null,
    t.note,
    owner,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A cost line's bank rule in words: `Payments to "Coles" or #groceries`. */
export function bankMatchLabel(match: string): string {
  const parts = bankMatchParts(match);
  if (parts.length > 1) return `Payments to ${parts.map((p) => (p.startsWith('#') ? p : `"${p}"`)).join(' or ')}`;
  return match.startsWith('#') ? `Tagged ${match}` : `Payments to "${match}"`;
}

/** "October" from a YYYY-MM key. */
export function monthLongName(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-AU', { month: 'long' });
}

/** "Oct" from a YYYY-MM key. */
export function monthShortName(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-AU', { month: 'short' }).slice(0, 3);
}

/** "Oct 31", the last day of a YYYY-MM key's month. */
export function monthLastDayLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
}

/** "Oct 28" from a YYYY-MM-DD day or an instant. */
export function costDayLabel(date: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : new Date(date);
  return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
}

/** Money with its sign: "+$120", "−$45". */
export function signedMoney(cents: number): string {
  return `${cents < 0 ? '−' : '+'}${formatMoney(Math.abs(cents))}`;
}

export interface GoalStatusLine {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  /** The bold lead: "Under goal so far." */
  lead: string;
  /** The quieter rest: "$846 left with 7 days to go." */
  detail?: string;
}

/**
 * The hero's status lines under the spend bar. Spent so far and the month-end
 * estimate get a line each, so a month that is under the goal today but
 * heading over says both instead of one red "over goal". Heading over is a
 * warning; only money already spent past the goal is red.
 */
export function goalStatus(month: CostMonth, goalCents: number | null, today: Date = new Date()): GoalStatusLine[] {
  const end = monthLastDayLabel(month.month);
  if (month.when === 'past') {
    if (!goalCents) return [{ tone: 'neutral', lead: 'Finished month.' }];
    const off = goalCents - month.paidCents;
    return [off >= 0 ? { tone: 'success', lead: `Finished ${formatMoney(off)} under goal.` } : { tone: 'danger', lead: `Finished ${formatMoney(-off)} over goal.` }];
  }
  if (month.when === 'future') {
    if (!goalCents) return [{ tone: 'neutral', lead: 'Forecast.' }];
    const off = goalCents - month.expectedCents;
    return [off >= 0 ? { tone: 'success', lead: `Looks ${formatMoney(off)} under goal.` } : { tone: 'warning', lead: `Looks ${formatMoney(-off)} over goal.` }];
  }
  const toCome = month.toComeCents > 0 ? `${formatMoney(month.toComeCents)} still to come.` : undefined;
  if (!goalCents) return [{ tone: 'neutral', lead: `About ${formatMoney(month.expectedCents)} by ${end}.`, detail: toCome }];
  const [y, m] = month.month.split('-').map(Number);
  const daysLeft = Math.max(0, new Date(y, m, 0).getDate() - today.getDate());
  const togo = daysLeft === 0 ? 'on the last day' : `with ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to go`;
  const left = goalCents - month.paidCents;
  const now: GoalStatusLine =
    left >= 0
      ? { tone: 'success', lead: 'Under goal so far.', detail: `${formatMoney(left)} left ${togo}.` }
      : { tone: 'danger', lead: `${formatMoney(-left)} over goal.`, detail: `${formatMoney(month.paidCents)} spent ${togo}.` };
  if (month.toComeCents <= 0) return [now];
  const off = goalCents - month.expectedCents;
  if (left < 0) return [now, { tone: 'neutral', lead: `About ${formatMoney(month.expectedCents)} by ${end}.`, detail: toCome }];
  return [now, off >= 0 ? { tone: 'success', lead: `On track to finish ${formatMoney(off)} under.`, detail: toCome } : { tone: 'warning', lead: `Heading ${formatMoney(-off)} over.`, detail: toCome }];
}
