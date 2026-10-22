// Money insights for the Costs screen, from the household's cost lines and
// what the bank shows was paid: the month-end forecast, nudges worth a look
// (a price that went up, a new subscription, a bill that hasn't come out, a
// category running ahead of its usual pace, the joint account looking short
// for the bills ahead) and the bills due soon. Platform-agnostic: both apps'
// Costs screens and the assistant read these.

import { CADENCE_LABEL, CATEGORY_META, costTargets, formatMoney, isOneOff, monthlyProjection, nextOccurrence, parseLocalDateOnly, type BankActuals } from './costs';
import type { BankAccountSummary, BankTransaction, CostActual, CostBankLink } from './up-bank';
import type { CostCadence, CostCategory, CostItem } from './types';

const DAY_MS = 86_400_000;

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function stepCadence(d: Date, cadence: Exclude<CostCadence, 'one_off'>): Date {
  const next = new Date(d);
  if (cadence === 'weekly') next.setDate(next.getDate() + 7);
  else if (cadence === 'fortnightly') next.setDate(next.getDate() + 14);
  else if (cadence === 'monthly') next.setMonth(next.getMonth() + 1);
  else if (cadence === 'quarterly') next.setMonth(next.getMonth() + 3);
  else next.setFullYear(next.getFullYear() + 1);
  return next;
}

/** monthlyProjection's bank input from the overview's actuals and links. */
export function bankActualsOf(actuals: readonly CostActual[], links: readonly CostBankLink[], since: string | null): BankActuals {
  const byItem = new Map<string, Map<string, number>>();
  for (const a of actuals) {
    const months = byItem.get(a.costItemId) ?? new Map<string, number>();
    months.set(a.month, (months.get(a.month) ?? 0) + a.cents);
    byItem.set(a.costItemId, months);
  }
  const linked = new Set<string>([...byItem.keys(), ...links.map((l) => l.costItemId)]);
  return { linked, byItem, since };
}

// ── Forecast ─────────────────────────────────────────────────────────────

export interface MonthForecast {
  /** Spent so far this month, positive cents. */
  spentCents: number;
  /** Where the month should end: every line's plan or what it already took, whichever is more, plus spending no line holds. */
  forecastCents: number;
  /** What's still to come: forecast less spent. */
  toComeCents: number;
}

/**
 * The month-end forecast. `items` are the lines that count (targets left
 * out); `spentCents` is what the bank shows went out this month, filed or
 * not, so spending no line holds still counts.
 */
export function monthForecast(items: CostItem[], bank: BankActuals | undefined, spentCents: number, now: Date = new Date()): MonthForecast {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const planned = monthlyProjection(items, start, 1, now, bank)[0]?.total ?? 0;
  const key = monthKeyOf(now);
  let filed = 0;
  if (bank) for (const months of bank.byItem.values()) filed += months.get(key) ?? 0;
  const forecastCents = Math.max(planned + Math.max(0, spentCents - filed), spentCents);
  return { spentCents, forecastCents, toComeCents: forecastCents - spentCents };
}

// ── Bills due ────────────────────────────────────────────────────────────

export interface BillDue {
  item: CostItem;
  due: Date;
  amountCents: number;
}

/**
 * When a recurring line is next due. A line the bank pays is due a cadence
 * after its last payment (more accurate than the start date); others follow
 * their start date.
 */
export function nextDue(item: CostItem, lastPaidAt: string | null | undefined, now: Date = new Date()): Date | null {
  if (isOneOff(item)) return nextOccurrence(item, now);
  if (lastPaidAt) {
    const paid = startOfDay(new Date(lastPaidAt));
    return stepCadence(paid, item.cadence as Exclude<CostCadence, 'one_off'>);
  }
  return nextOccurrence(item, now);
}

/** Categories whose lines are bills even when the amount changes (electricity). */
const BILL_CATEGORIES: ReadonlySet<CostCategory> = new Set(['rent', 'utilities', 'internet', 'insurance', 'subscription']);

/**
 * A bill is a recurring line with a due date: a fixed amount, or an estimate
 * in a bill category (electricity). Other estimates (groceries, cafes,
 * fuel) are spending, not bills.
 */
export function isBill(item: Pick<CostItem, 'deleted' | 'cadence' | 'is_estimate' | 'category'>): boolean {
  if (item.deleted || item.cadence === 'one_off') return false;
  return !item.is_estimate || BILL_CATEGORIES.has(item.category);
}

/** Bills due from today to `days` ahead, soonest first. */
export function billsDue(items: readonly CostItem[], links: readonly CostBankLink[], now: Date = new Date(), days = 14): BillDue[] {
  const today = startOfDay(now);
  const until = new Date(today.getTime() + days * DAY_MS);
  const lastPaid = new Map(links.map((l) => [l.costItemId, l.lastPaidAt]));
  const out: BillDue[] = [];
  for (const item of items) {
    if (!isBill(item)) continue;
    let due = nextDue(item, lastPaid.get(item.id), now);
    // A bill paid long ago with nothing since rolls forward to its next date.
    while (due && due < today && lastPaid.get(item.id)) {
      const overdueDays = (today.getTime() - due.getTime()) / DAY_MS;
      if (overdueDays <= 7) break;
      due = stepCadence(due, item.cadence as Exclude<CostCadence, 'one_off'>);
    }
    if (!due || due < today || due > until) continue;
    out.push({ item, due, amountCents: item.amount ?? 0 });
  }
  return out.sort((a, b) => a.due.getTime() - b.due.getTime() || a.item.name.localeCompare(b.item.name));
}

// ── Nudges ───────────────────────────────────────────────────────────────

export type MoneyNudge =
  | { kind: 'price'; key: string; item: CostItem; fromCents: number; toCents: number }
  /** The latest payment differs from a line that doesn't follow its payments: offer to update it. */
  | { kind: 'differs'; key: string; item: CostItem; paidCents: number; paidAt: string }
  | { kind: 'new'; key: string; item: CostItem; amountCents: number }
  | { kind: 'missing'; key: string; item: CostItem; dueOn: Date; amountCents: number }
  | { kind: 'ahead'; key: string; category: CostCategory; paidCents: number; usualCents: number }
  | { kind: 'short'; key: string; balanceCents: number; billsCents: number; bills: number; until: Date };

export interface MoneyNudgeInput {
  /** The lines that count (targets left out). */
  items: readonly CostItem[];
  links: readonly CostBankLink[];
  bank?: BankActuals;
  /** Accounts in view: the joint everyday balance checks the bills ahead. */
  accounts?: readonly BankAccountSummary[];
  now?: Date;
}

/** Nudges worth a look, most pressing first, at most `limit`. */
export function moneyNudges(input: MoneyNudgeInput, limit = 4): MoneyNudge[] {
  const now = input.now ?? new Date();
  const today = startOfDay(now);
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const out: MoneyNudge[] = [];

  // The joint account looks short for the bills in the next week.
  const joint = (input.accounts ?? []).filter((a) => a.joint && a.type === 'TRANSACTIONAL');
  if (joint.length) {
    const week = billsDue(input.items, input.links, now, 7);
    const billsCents = week.reduce((s, b) => s + b.amountCents, 0);
    const balanceCents = joint.reduce((s, a) => s + a.balanceCents, 0);
    if (week.length && billsCents > balanceCents) {
      out.push({ kind: 'short', key: 'short', balanceCents, billsCents, bills: week.length, until: week[week.length - 1].due });
    }
  }

  for (const link of input.links) {
    const item = byId.get(link.costItemId);
    if (!item || !isBill(item) || !link.lastPaidAt) continue;
    const lastPaid = new Date(link.lastPaidAt);

    // A bill that hasn't come out: due a cadence after the last payment, four days gone.
    const due = nextDue(item, link.lastPaidAt, now);
    if (due && today.getTime() - due.getTime() > 4 * DAY_MS && today.getTime() - due.getTime() < 40 * DAY_MS) {
      out.push({ kind: 'missing', key: `missing:${item.id}`, item, dueOn: due, amountCents: item.amount ?? 0 });
      continue;
    }

    // A line made by hand that doesn't follow its payments, now out of step.
    if (!link.keepAmount && !item.bank_source && link.lastAmountCents != null && link.lastAmountCents !== (item.amount ?? 0)) {
      out.push({ kind: 'differs', key: `differs:${item.id}`, item, paidCents: link.lastAmountCents, paidAt: link.lastPaidAt });
      continue;
    }

    // A price that changed on the latest payment, in the last six weeks.
    const to = link.lastAmountCents;
    const from = link.prevAmountCents;
    if (to != null && from != null && from > 0 && now.getTime() - lastPaid.getTime() < 42 * DAY_MS) {
      const diff = to - from;
      if (Math.abs(diff) >= 100 && Math.abs(diff) >= from * 0.02) {
        out.push({ kind: 'price', key: `price:${item.id}`, item, fromCents: from, toCents: to });
        continue;
      }
    }

    // A new subscription: a regular payment the bank first saw in the last six weeks,
    // with at least a month of data before it.
    if (item.bank_source && item.start_date && input.bank?.since) {
      const start = parseLocalDateOnly(item.start_date);
      const covered = parseLocalDateOnly(`${input.bank.since}-01`);
      if (now.getTime() - start.getTime() < 42 * DAY_MS && start.getTime() - covered.getTime() > 28 * DAY_MS) {
        out.push({ kind: 'new', key: `new:${item.id}`, item, amountCents: item.amount ?? 0 });
      }
    }
  }

  // Variable spending running ahead of its usual pace by this day of the month.
  if (input.bank) {
    const key = monthKeyOf(now);
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const share = Math.min(1, now.getDate() / daysIn);
    const prior = [1, 2, 3]
      .map((k) => monthKeyOf(new Date(now.getFullYear(), now.getMonth() - k, 1)))
      .filter((m) => !input.bank!.since || m >= input.bank!.since);
    if (prior.length && share >= 0.2) {
      const paid = new Map<CostCategory, number>();
      const usual = new Map<CostCategory, number>();
      for (const item of input.items) {
        if (!item.is_estimate || isOneOff(item)) continue;
        const months = input.bank.byItem.get(item.id);
        if (!months) continue;
        paid.set(item.category, (paid.get(item.category) ?? 0) + (months.get(key) ?? 0));
        const avg = prior.reduce((s, m) => s + (months.get(m) ?? 0), 0) / prior.length;
        usual.set(item.category, (usual.get(item.category) ?? 0) + avg);
      }
      for (const [category, paidCents] of paid) {
        const usualCents = Math.round((usual.get(category) ?? 0) * share);
        if (usualCents > 0 && paidCents > usualCents * 1.2 && paidCents - usualCents >= 5000) {
          out.push({ kind: 'ahead', key: `ahead:${category}`, category, paidCents, usualCents });
        }
      }
    }
  }

  const rank: Record<MoneyNudge['kind'], number> = { short: 0, missing: 1, differs: 2, price: 3, new: 4, ahead: 5 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, limit);
}

// ── Copy ─────────────────────────────────────────────────────────────────

/** "today", "tomorrow", "in 3 days", "2 days ago". */
export function relativeDay(d: Date, now: Date = new Date()): string {
  const days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY_MS);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export interface MoneyNudgeCopy {
  title: string;
  detail: string;
  /** A short figure for the row's end, with its tone. */
  figure?: { text: string; tone: 'warning' | 'success' | 'muted' };
}

/** The words both apps show for a nudge (Hearth copy: fragments, no em dashes). */
export function moneyNudgeCopy(n: MoneyNudge, now: Date = new Date()): MoneyNudgeCopy {
  switch (n.kind) {
    case 'short':
      return {
        title: 'Joint account may run short',
        detail: `${formatMoney(n.billsCents)} in bills by ${relativeDay(n.until, now)}, ${formatMoney(n.balanceCents)} in the account`,
        figure: { text: `${formatMoney(n.billsCents - n.balanceCents)} short`, tone: 'warning' },
      };
    case 'missing':
      return {
        title: `${n.item.name} hasn't come out`,
        detail: `Usually due ${relativeDay(n.dueOn, now)}, about ${formatMoney(n.amountCents)}`,
      };
    case 'differs': {
      const up = n.paidCents > (n.item.amount ?? 0);
      return {
        title: `${n.item.name} went ${up ? 'up' : 'down'}`,
        detail: `Paid ${formatMoney(n.paidCents)}, the line says ${formatMoney(n.item.amount ?? 0)}`,
      };
    }
    case 'price': {
      const up = n.toCents > n.fromCents;
      const perYear = Math.abs(n.toCents - n.fromCents) * (YEARLY[n.item.cadence] ?? 12);
      return {
        title: `${n.item.name} went ${up ? 'up' : 'down'}`,
        detail: `${formatMoney(n.fromCents)} to ${formatMoney(n.toCents)}${CADENCE_LABEL[n.item.cadence]}`,
        figure: { text: `${up ? '+' : '-'}${formatMoney(perYear)} a year`, tone: up ? 'warning' : 'success' },
      };
    }
    case 'new':
      return {
        title: `New: ${n.item.name}`,
        detail: `${formatMoney(n.amountCents)}${CADENCE_LABEL[n.item.cadence]} from the joint account`,
      };
    case 'ahead': {
      const pct = Math.round(((n.paidCents - n.usualCents) / n.usualCents) * 100);
      return {
        title: `${CATEGORY_META[n.category].label} running ahead`,
        detail: `${formatMoney(n.paidCents)} so far, usually ${formatMoney(n.usualCents)} by now`,
        figure: { text: `+${pct}%`, tone: 'warning' },
      };
    }
  }
}

const YEARLY: Partial<Record<CostCadence, number>> = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1 };

// ── Weekly digest ────────────────────────────────────────────────────────

export interface WeeklyDigestInput {
  /** Every live cost line; targets are left out here. */
  items: readonly CostItem[];
  links: readonly CostBankLink[];
  bank?: BankActuals;
  /** The household's accounts: the joint balance checks the bills ahead. */
  accounts?: readonly BankAccountSummary[];
  /** Payments the household shares from the last seven days. */
  week: readonly BankTransaction[];
  /** What the household spent this month so far, for the forecast. */
  monthSpentCents: number;
  now?: Date;
}

/**
 * The assistant's Sunday note in the Household chat: the week's spending and
 * where most of it went, nudges worth a look, the bills in the next seven
 * days and the month's forecast. Null when there's nothing to say. Written
 * in the assistant's reply format (bullets, **bold**, app links).
 */
export function weeklyMoneyDigest(input: WeeklyDigestInput): string | null {
  const now = input.now ?? new Date();
  const targets = costTargets(input.items);
  const items = input.items.filter((i) => !i.deleted && !targets.has(i.id));

  const seen = new Set<string>();
  const byPayee = new Map<string, number>();
  let spent = 0;
  for (const r of input.week) {
    if (r.is_transfer || r.hidden || r.amount_cents >= 0 || seen.has(r.external_id)) continue;
    seen.add(r.external_id);
    spent += -r.amount_cents;
    byPayee.set(r.description, (byPayee.get(r.description) ?? 0) + -r.amount_cents);
  }
  const top = Array.from(byPayee).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const nudges = moneyNudges({ items, links: input.links, bank: input.bank, accounts: input.accounts, now });
  const bills = billsDue(items, input.links, now, 7);
  if (!spent && !nudges.length && !bills.length) return null;

  const parts: string[] = [];
  if (spent) {
    const where = top.map(([name, cents]) => `${name} (${formatMoney(cents)})`);
    const list = where.length > 1 ? `${where.slice(0, -1).join(', ')} and ${where[where.length - 1]}` : where[0];
    parts.push(`**Your week in money:** ${formatMoney(spent)} spent from shared accounts. Most went to ${list}.`);
  } else {
    parts.push('**Your week in money:** nothing spent from shared accounts this week.');
  }
  if (nudges.length) {
    parts.push(['Worth a look:', ...nudges.map((n) => {
      const copy = moneyNudgeCopy(n, now);
      return `- ${copy.title}. ${copy.detail}.`;
    })].join('\n'));
  }
  if (bills.length) {
    parts.push(['Bills in the next 7 days:', ...bills.map((b) => `- ${b.item.name}, ${formatMoney(b.amountCents)}, ${relativeDay(b.due, now)}`)].join('\n'));
  }
  const forecast = monthForecast(items, input.bank, input.monthSpentCents, now);
  const month = now.toLocaleString('en-AU', { month: 'long' });
  if (forecast.forecastCents > 0) {
    parts.push(`${month} is on track for ${formatMoney(forecast.forecastCents)}, with ${formatMoney(forecast.spentCents)} spent so far. [Open Costs](/costs)`);
  }
  return parts.join('\n\n');
}
