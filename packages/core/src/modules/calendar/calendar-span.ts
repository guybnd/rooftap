// The calendar's Day / Week / Month span (household feedback: "why can't I
// see more than just today... a default weekly view, and scroll to the next
// ones"). Pure date math both apps share; weeks start on Sunday like
// getWeekDays.
import { getWeekDays, startOfWeekFor } from './calendar-overlap';

export type CalendarSpan = 'day' | 'week' | 'month';

export const CALENDAR_SPAN_OPTIONS: { value: CalendarSpan; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function atMidnight(y: number, m: number, d: number): Date {
  return new Date(y, m, d);
}

/** Every day the span covers, in order. */
export function calendarSpanDays(span: CalendarSpan, date: Date): Date[] {
  if (span === 'day') return [atMidnight(date.getFullYear(), date.getMonth(), date.getDate())];
  if (span === 'week') return getWeekDays(date);
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => atMidnight(date.getFullYear(), date.getMonth(), i + 1));
}

/** The 6 x 7 month grid: whole weeks from the Sunday on or before the 1st. */
export function monthGridDays(date: Date): Date[] {
  const start = startOfWeekFor(new Date(date.getFullYear(), date.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => atMidnight(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** The same date one span later (`step` 1) or earlier (-1); a month step keeps the day, clamped to the month's end. */
export function shiftCalendarDate(span: CalendarSpan, date: Date, step: number): Date {
  if (span === 'day') return atMidnight(date.getFullYear(), date.getMonth(), date.getDate() + step);
  if (span === 'week') return atMidnight(date.getFullYear(), date.getMonth(), date.getDate() + 7 * step);
  const target = new Date(date.getFullYear(), date.getMonth() + step, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return atMidnight(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
}

/** "Mon 19 Oct", "18 to 24 Oct", "27 Sep to 3 Oct", "October 2026". */
export function calendarSpanLabel(span: CalendarSpan, date: Date): string {
  if (span === 'day') return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  if (span === 'month') return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
  const days = getWeekDays(date);
  const first = days[0];
  const last = days[6];
  return first.getMonth() === last.getMonth()
    ? `${first.getDate()} to ${last.getDate()} ${MONTHS[last.getMonth()]}`
    : `${first.getDate()} ${MONTHS[first.getMonth()]} to ${last.getDate()} ${MONTHS[last.getMonth()]}`;
}

/** The hero lede's tail for the span: "this week", "next week", "in October". Day spans keep the caller's own wording. */
export function calendarSpanLede(span: Exclude<CalendarSpan, 'day'>, date: Date, today: Date = new Date()): string {
  if (span === 'month') {
    const sameYear = date.getFullYear() === today.getFullYear();
    return `in ${MONTHS_LONG[date.getMonth()]}${sameYear ? '' : ` ${date.getFullYear()}`}`;
  }
  const weeks = Math.round((startOfWeekFor(date).getTime() - startOfWeekFor(today).getTime()) / (7 * 86400000));
  if (weeks === 0) return 'this week';
  if (weeks === 1) return 'next week';
  if (weeks === -1) return 'last week';
  return `in ${calendarSpanLabel('week', date)}`;
}
