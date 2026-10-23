// Money summaries from the Assistant (the money-insights module, Oct 23): the
// notes the server posts to the Household chat when someone asks for them in
// Costs. Both read the months costMonth works out and the insights the Costs
// card shows, so the note says what the page says.
// - Weekly (Sunday), for a household without a bank connection: what was
//   added this week, the insights, the bills in the next seven days and where
//   the month is heading. A household with a bank gets weeklyMoneyDigest.
// - Monthly (the 1st): last month against the goal and the month before, the
//   biggest categories, the subscriptions and what is worth a look now.
// Written in the assistant's reply format (bullets, **bold**, app links).

import { billsDue, relativeDay } from '../costs/money-insights';
import { costCategoryLabel, type CostMonth } from '../costs/cost-month';
import { costInsights, type CostInsightMarks } from './cost-insights';
import { costTargets, parseLocalDateOnly } from '../costs/costs';
import { formatMoney } from '../../money-format';
import type { CostItem } from '../../types';

/** How each person asked for summaries (user_settings.money_summaries). */
export interface MoneySummaryPrefs {
  weekly?: boolean;
  monthly?: boolean;
}

export type MoneySummaryKind = keyof MoneySummaryPrefs;

/** The first words of each note, so the server can tell it already posted one. */
export const MONEY_SUMMARY_MARKER: Record<MoneySummaryKind, string> = {
  weekly: '**Your week in money',
  monthly: '**Your month in money',
};

export interface MoneySummaryInput {
  /** Live cost lines. */
  items: readonly CostItem[];
  /** costMonth results, oldest first, ending with the current month. */
  months: readonly CostMonth[];
  goalCents?: number | null;
  /** The person's hidden insights, so the note leaves them out too. */
  marks?: CostInsightMarks;
  /** The household's local wall clock. */
  now: Date;
}

const MAX_INSIGHTS = 4;

/** The weekly note for a household without a bank. Null when there's nothing to say. */
export function weeklyCostsSummary(input: MoneySummaryInput): string | null {
  const { now } = input;
  const current = input.months[input.months.length - 1];
  if (!current) return null;
  const targets = costTargets(input.items);
  const items = input.items.filter((i) => !i.deleted && !i.archived && !targets.has(i.id));

  // Costs dated in the last seven days, from this month and the end of the last.
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const week = new Map<string, number>();
  let spent = 0;
  for (const m of input.months.slice(-2)) {
    for (const c of m.categories) {
      for (const l of c.lines) {
        if (!l.paidCents || !l.date) continue;
        const at = /^\d{4}-\d{2}-\d{2}$/.test(l.date) ? parseLocalDateOnly(l.date) : new Date(l.date);
        if (at < from || at > now) continue;
        spent += l.paidCents;
        week.set(l.name, (week.get(l.name) ?? 0) + l.paidCents);
      }
    }
  }
  const { insights } = costInsights({ items, months: input.months, goalCents: input.goalCents, marks: input.marks, now });
  const bills = billsDue(items, [], now, 7);
  if (!spent && !insights.length && !bills.length) return null;

  const parts: string[] = [];
  if (spent) {
    const top = [...week].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, cents]) => `${name} (${formatMoney(cents)})`);
    parts.push(`${MONEY_SUMMARY_MARKER.weekly}:** ${formatMoney(spent)} in costs this week. Most went to ${listOf(top)}.`);
  } else {
    parts.push(`${MONEY_SUMMARY_MARKER.weekly}:** no new costs this week.`);
  }
  if (insights.length) parts.push(['Worth a look:', ...insights.slice(0, MAX_INSIGHTS).map((i) => `- ${i.title}. ${i.detail}.`)].join('\n'));
  if (bills.length) parts.push(['Bills in the next 7 days:', ...bills.map((b) => `- ${b.item.name}, ${formatMoney(b.amountCents)}, ${relativeDay(b.due, now)}`)].join('\n'));
  if (current.expectedCents > 0) {
    const goal = input.goalCents ? ` of your ${formatMoney(input.goalCents)} goal` : '';
    parts.push(`${monthName(current.month)} is on track for ${formatMoney(current.expectedCents)}${goal}, with ${formatMoney(current.paidCents)} spent so far. [Open Costs](/costs)`);
  }
  return parts.join('\n\n');
}

/** The note on the 1st about the month that just ended. Null when it had no costs. */
export function monthlyMoneyRecap(input: MoneySummaryInput): string | null {
  const { now } = input;
  const past = input.months.filter((m) => m.when === 'past');
  const last = past[past.length - 1];
  if (!last || !last.paidCents) return null;
  const before = past[past.length - 2];
  const name = monthName(last.month);

  const parts: string[] = [];
  const goal = input.goalCents ?? 0;
  const vsGoal = goal
    ? last.paidCents <= goal
      ? `, ${formatMoney(goal - last.paidCents)} under your ${formatMoney(goal)} goal`
      : `, ${formatMoney(last.paidCents - goal)} over your ${formatMoney(goal)} goal`
    : '';
  const vsBefore = before?.paidCents
    ? ` That is ${formatMoney(Math.abs(last.paidCents - before.paidCents))} ${last.paidCents >= before.paidCents ? 'more' : 'less'} than ${monthName(before.month)}.`
    : '';
  const income = last.incomeCents ? ` ${formatMoney(last.incomeCents)} came in.` : '';
  parts.push(`${MONEY_SUMMARY_MARKER.monthly} (${name}):** ${formatMoney(last.paidCents)} spent${vsGoal}.${vsBefore}${income}`);

  const top = last.categories.filter((c) => c.paidCents > 0).slice(0, 4);
  if (top.length) parts.push(['Where it went:', ...top.map((c) => `- ${costCategoryLabel(c.category)}, ${formatMoney(c.paidCents)}`)].join('\n'));

  if (before) {
    const was = new Map(before.categories.map((c) => [c.category, c.paidCents]));
    const moves = last.categories
      .map((c) => ({ c, diff: c.paidCents - (was.get(c.category) ?? 0) }))
      .filter((m) => m.c.category && Math.abs(m.diff) >= 5000)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 3);
    if (moves.length) {
      parts.push(
        [`Compared with ${monthName(before.month)}:`, ...moves.map((m) => `- ${costCategoryLabel(m.c.category)} ${m.diff > 0 ? 'up' : 'down'} ${formatMoney(Math.abs(m.diff))}`)].join('\n'),
      );
    }
  }

  const targets = costTargets(input.items);
  const items = input.items.filter((i) => !i.deleted && !targets.has(i.id));
  const { insights, subscriptions } = costInsights({ items, months: input.months, goalCents: input.goalCents, marks: input.marks, now });
  if (subscriptions.length) {
    const monthly = subscriptions.reduce((s, x) => s + x.monthlyCents, 0);
    parts.push(`Subscriptions: ${subscriptions.length}, ${formatMoney(monthly)} a month (${formatMoney(monthly * 12)} a year).`);
  }
  const worth = insights.filter((i) => i.kind !== 'subscriptions').slice(0, MAX_INSIGHTS);
  if (worth.length) parts.push(['Worth a look now:', ...worth.map((i) => `- ${i.title}. ${i.detail}.`)].join('\n'));
  parts.push('[Open Costs](/costs)');
  return parts.join('\n\n');
}

/** Which notes are due today on the household's wall clock: weekly on Sunday, monthly on the 1st. */
export function moneySummariesDue(now: Date): MoneySummaryKind[] {
  const due: MoneySummaryKind[] = [];
  if (now.getDay() === 0) due.push('weekly');
  if (now.getDate() === 1) due.push('monthly');
  return due;
}

/** Days a note waits before another of its kind can post, so a second run the same day does nothing. */
export const MONEY_SUMMARY_QUIET_DAYS: Record<MoneySummaryKind, number> = { weekly: 5, monthly: 20 };

function monthName(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-AU', { month: 'long' });
}

function listOf(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
}
