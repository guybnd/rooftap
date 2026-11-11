// The Week helper's brief (module-helpers.ts): what is late, what is on for
// today and what the rest of the week holds, from the household's to-dos,
// with no AI. The same function runs on the device and on the server. The
// rows are the to-dos' own rows, so they tick, snooze and reassign in place.

import type { HouseholdTask } from '../../types';
import { addDaysISO, daysBetweenISO, dueDayLabel } from '../../date-utils';
import type { BriefRow, BriefSection, HelperBrief } from '../../module-helpers';
import { compareTasksByDueDateTimeOrder } from './task-list-view';
import { isAssignedTo } from '../../assignees';

/** At most this many rows a section; the chat folds the rest under Show all. */
const WEEK_ROWS = 40;

export function weekBrief(input: {
  /** The to-dos this person can see (others' private ones already left out). */
  tasks: readonly HouseholdTask[];
  /** YYYY-MM-DD. */
  today: string;
  me?: string | null;
}): HelperBrief {
  const open = input.tasks.filter((t) => t && !t.deleted && !t.done && typeof t.due_date === 'string').sort(compareTasksByDueDateTimeOrder);
  const last = addDaysISO(input.today, 6);
  const late = open.filter((t) => t.due_date! < input.today);
  const today = open.filter((t) => t.due_date === input.today);
  const week = open.filter((t) => t.due_date! > input.today && t.due_date! <= last);
  const row = (t: HouseholdTask): BriefRow => ({
    kind: 'item',
    id: t.id,
    title: t.title,
    trailing: dueDayLabel(t.due_date!, input.today),
    warn: t.due_date! < input.today,
  });
  const sections: BriefSection[] = [];
  if (late.length) sections.push({ id: 'late', title: 'Overdue', rows: late.slice(0, WEEK_ROWS).map(row), module: 'household' });
  if (today.length) sections.push({ id: 'today', title: 'Today', rows: today.slice(0, WEEK_ROWS).map(row), module: 'household' });
  if (week.length) sections.push({ id: 'week', title: 'Later this week', rows: week.slice(0, WEEK_ROWS).map(row), module: 'household' });

  const mine = input.me ? [...late, ...today].filter((t) => isAssignedTo(t, input.me)).length : 0;
  const parts: string[] = [];
  if (late.length) parts.push(`${late.length} overdue`);
  parts.push(today.length ? `${today.length} for today` : 'nothing due today');
  if (week.length) parts.push(`${week.length} later this week`);
  const oldest = late.length ? daysBetweenISO(late[0].due_date!, input.today) : 0;
  const lede =
    `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}.` +
    (mine ? ` ${mine === 1 ? 'One of the urgent ones is' : `${mine} of the urgent ones are`} yours.` : '') +
    (oldest >= 7 ? ` The oldest has waited ${oldest} days.` : '');
  const title = late.length ? 'Some catching up to do' : today.length ? "Today's to-dos" : week.length ? 'Your week' : 'All clear';
  return { title, lede, sections };
}
