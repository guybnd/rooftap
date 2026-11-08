// The Money helper's brief (module-helpers.ts): the bills coming up and the
// deals about to end, from the household's cost lines, with no AI. The same
// function runs on the device (the chat's opening rows) and on the server
// (the prompt). Bank payments are left to the helper's tools: they need the
// connector's ledger, and the brief opens at once from the synced store.

import type { CostItem } from '../../types';
import { addDaysISO, daysBetweenISO, toISODate } from '../../date-utils';
import { formatMoney } from '../../money-format';
import type { BriefRow, BriefSection, HelperBrief } from '../../module-helpers';
import { isOneOff, nextOccurrence } from './costs';
import { soonestCostExpiry } from './cost-dates';

/** Bills due within this many days count as this week's. */
export const MONEY_BRIEF_DAYS = 7;
/** Deals and contracts ending within this many days are worth a look. */
export const MONEY_BRIEF_ENDING_DAYS = 45;

function dueLabel(days: number): string {
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
}

export function moneyBrief(input: { items: readonly CostItem[]; today: string }): HelperBrief {
  const live = input.items.filter((i) => i && !i.deleted && !i.archived && i.category !== 'income');
  const [y, m, d] = input.today.split('-').map(Number);
  const from = new Date(y, m - 1, d);
  const last = addDaysISO(input.today, MONEY_BRIEF_DAYS - 1);

  const due: { item: CostItem; date: string; days: number }[] = [];
  for (const item of live) {
    const next = nextOccurrence(item, from);
    if (!next) continue;
    const date = toISODate(next);
    if (date > last) continue;
    due.push({ item, date, days: daysBetweenISO(input.today, date) });
  }
  due.sort((a, b) => a.date.localeCompare(b.date) || b.item.amount - a.item.amount);
  const dueCents = due.reduce((n, b) => n + (b.item.amount || 0), 0);

  const ending: { item: CostItem; label: string; days: number }[] = [];
  for (const item of live) {
    if (isOneOff(item)) continue;
    const soonest = soonestCostExpiry(item, from);
    if (!soonest || soonest.days < 0 || soonest.days > MONEY_BRIEF_ENDING_DAYS) continue;
    ending.push({ item, days: soonest.days, label: soonest.days === 0 ? `${soonest.kind} ends today` : `${soonest.kind} ends in ${soonest.days} days` });
  }
  ending.sort((a, b) => a.days - b.days);

  const sections: BriefSection[] = [];
  if (due.length) {
    const rows: BriefRow[] = due.map((b) => ({
      kind: 'item',
      id: b.item.id,
      title: b.item.name,
      meta: formatMoney(b.item.amount),
      trailing: dueLabel(b.days),
      warn: b.days === 0,
    }));
    sections.push({ id: 'due', title: 'Due this week', rows, module: 'costs' });
  }
  if (ending.length) {
    const rows: BriefRow[] = ending.map((e) => ({ kind: 'item', id: e.item.id, title: e.item.name, meta: e.item.provider, trailing: e.label }));
    sections.push({ id: 'ending', title: 'Deals and contracts ending', rows, module: 'costs' });
  }

  const said: string[] = [];
  if (due.length) said.push(`${due.length === 1 ? '1 bill' : `${due.length} bills`} due this week, ${formatMoney(dueCents)} in all.`);
  else said.push('No bills due this week.');
  if (ending.length) said.push(`${ending.length === 1 ? 'One deal or contract ends' : `${ending.length} deals or contracts end`} soon, worth checking before it rolls over.`);
  return { title: due.length ? 'Bills this week' : 'A quiet week for bills', lede: said.join(' '), sections };
}
