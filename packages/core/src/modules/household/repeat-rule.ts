// Calendar repeat rules for tasks: the iCalendar RRULE subset Google Calendar
// offers, so "1st of every month", "first Sunday of the month", "last day of
// the month" and "every 2 weeks on Mon and Thu" land on real dates instead of
// drifting like a fixed day count. Stored in household_tasks.repeat_rule
// (20261029220000_task_repeat_rule); recurrence_days keeps an approximate day
// count so an app or server that predates the rule still repeats the task.

import { recurrenceLabel } from '../../date-utils';

export type RepeatFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

export interface RepeatRule {
  freq: RepeatFreq;
  /** Every this many days/weeks/months/years; 1 or more. */
  interval: number;
  /** Weekly: the days it falls on. Daily: only these days (every weekday). */
  byDay?: Weekday[];
  /** Monthly/yearly: day of the month, 1 to 31, or -1 for the last day. */
  byMonthDay?: number;
  /** Monthly/yearly: the nth weekday of the month (nth 1 to 5, or -1 for the last). */
  byNthDay?: { nth: number; day: Weekday };
  /** Yearly: the month, 1 to 12. */
  byMonth?: number;
  /** Occurrences left, this one included. Each completion counts one down. */
  count?: number;
  /** Last day it can fall on, YYYY-MM-DD. */
  until?: string;
}

export const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const WEEKDAY_NAMES: Record<Weekday, string> = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
};
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const NTH_WORDS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last' };

// ---- dates (UTC arithmetic on plain YYYY-MM-DD, so no DST surprises) ----

function toUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fromUTC(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function addDays(iso: string, n: number): string {
  const dt = toUTC(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}
/** Weekday of a date, MO..SU. */
export function weekdayOf(iso: string): Weekday {
  return WEEKDAYS[(toUTC(iso).getUTCDay() + 6) % 7];
}
/** Which of its weekday in the month a date is: 1 to 5. */
function nthOfMonth(iso: string): number {
  return Math.ceil(Number(iso.slice(8, 10)) / 7);
}
function isLastOfMonth(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  return d === daysInMonth(y, m);
}

/** The day in month y-m the rule's month part picks, or null when the month has none (the 31st in April). */
function dayInMonth(rule: RepeatRule, y: number, m: number, fallbackDay: number): string | null {
  const dim = daysInMonth(y, m);
  if (rule.byNthDay) {
    const target = WEEKDAYS.indexOf(rule.byNthDay.day);
    const firstWd = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const first = 1 + ((target - firstWd + 7) % 7);
    if (rule.byNthDay.nth === -1) {
      let d = first;
      while (d + 7 <= dim) d += 7;
      return ymd(y, m, d);
    }
    const d = first + (rule.byNthDay.nth - 1) * 7;
    return d <= dim ? ymd(y, m, d) : null;
  }
  const want = rule.byMonthDay ?? fallbackDay;
  if (want === -1) return ymd(y, m, dim);
  return want <= dim ? ymd(y, m, want) : null;
}

/**
 * The first date the rule falls on after `after` (YYYY-MM-DD), taking `after`
 * as an occurrence the steps count from. Null once past `until`. `count` is
 * left to the caller (see nextRepeat).
 */
export function nextRepeatDate(rule: RepeatRule, after: string): string | null {
  const interval = Math.max(1, rule.interval || 1);
  const [ay, am, ad] = after.split('-').map(Number);
  let next: string | null = null;

  if (rule.freq === 'DAILY') {
    if (rule.byDay?.length) {
      let d = addDays(after, 1);
      for (let i = 0; i < 14 && !rule.byDay.includes(weekdayOf(d)); i++) d = addDays(d, 1);
      next = d;
    } else {
      next = addDays(after, interval);
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = (rule.byDay?.length ? rule.byDay : [weekdayOf(after)])
      .map((d) => WEEKDAYS.indexOf(d))
      .sort((a, b) => a - b);
    const idx = WEEKDAYS.indexOf(weekdayOf(after));
    const later = days.find((d) => d > idx);
    if (later !== undefined) next = addDays(after, later - idx);
    else next = addDays(after, interval * 7 - idx + days[0]);
  } else if (rule.freq === 'MONTHLY') {
    // Same month first (a later day), then every `interval` months; a month
    // with no such day (the 31st in June, a fifth Friday) is skipped.
    for (let k = 0; k <= 120 && !next; k += interval) {
      const total = am - 1 + k;
      const y = ay + Math.floor(total / 12);
      const m = (total % 12) + 1;
      const d = dayInMonth(rule, y, m, ad);
      if (d && d > after) next = d;
    }
  } else {
    const month = rule.byMonth ?? am;
    for (let k = 0; k <= 40 && !next; k += interval) {
      const d = dayInMonth(rule, ay + k, month, ad);
      if (d && d > after) next = d;
    }
  }

  if (!next) return null;
  if (rule.until && next > rule.until) return null;
  return next;
}

/**
 * The next due date and the rule it carries when a repeating task is ticked
 * off. Steps from the due date (today when it has none) and rolls forward so
 * the next one is never in the past. Null when the rule has run out (its last
 * count, or past `until`).
 */
export function nextRepeat(
  rule: RepeatRule,
  dueDate: string | null,
  today: string,
): { dueDate: string; rule: RepeatRule } | null {
  if (rule.count !== undefined && rule.count <= 1) return null;
  let next = nextRepeatDate(rule, dueDate ?? today);
  for (let i = 0; next && next < today && i < 5000; i++) next = nextRepeatDate(rule, next);
  if (!next) return null;
  const carried = rule.count !== undefined ? { ...rule, count: rule.count - 1 } : rule;
  return { dueDate: next, rule: carried };
}

/**
 * Fill in what a bare rule takes from the first due date, the way a calendar
 * reads DTSTART: "FREQ=MONTHLY" due on the 1st becomes "on day 1", so later
 * steps don't depend on whatever date they count from.
 */
export function anchorRepeatRule(rule: RepeatRule, dueDate: string): RepeatRule {
  const day = Number(dueDate.slice(8, 10));
  const month = Number(dueDate.slice(5, 7));
  if (rule.freq === 'WEEKLY' && !rule.byDay?.length) return { ...rule, byDay: [weekdayOf(dueDate)] };
  if (rule.freq === 'MONTHLY' && rule.byMonthDay === undefined && !rule.byNthDay) return { ...rule, byMonthDay: day };
  if (rule.freq === 'YEARLY') {
    const r = { ...rule, byMonth: rule.byMonth ?? month };
    if (r.byMonthDay === undefined && !r.byNthDay) r.byMonthDay = day;
    return r;
  }
  return rule;
}

/** The first date on or after `from` that the rule falls on: where a new repeating task starts. */
export function firstRepeatDate(rule: RepeatRule, from: string): string | null {
  if (rule.until && from > rule.until) return null;
  return repeatFallsOn(rule, from) ? from : nextRepeatDate(rule, from);
}

/** True when `date` is a day the rule falls on (ignoring interval phase). */
export function repeatFallsOn(rule: RepeatRule, date: string): boolean {
  const day = Number(date.slice(8, 10));
  const month = Number(date.slice(5, 7));
  const wd = weekdayOf(date);
  const monthPart = () => {
    if (rule.byNthDay) {
      if (wd !== rule.byNthDay.day) return false;
      return rule.byNthDay.nth === -1 ? Number(addDays(date, 7).slice(5, 7)) !== month : nthOfMonth(date) === rule.byNthDay.nth;
    }
    if (rule.byMonthDay === -1) return isLastOfMonth(date);
    return rule.byMonthDay === undefined || rule.byMonthDay === day;
  };
  switch (rule.freq) {
    case 'DAILY':
      return !rule.byDay?.length || rule.byDay.includes(wd);
    case 'WEEKLY':
      return !rule.byDay?.length || rule.byDay.includes(wd);
    case 'MONTHLY':
      return monthPart();
    case 'YEARLY':
      return (rule.byMonth === undefined || rule.byMonth === month) && monthPart();
  }
}

// ---- RRULE text ----

const FREQS: RepeatFreq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

/**
 * Read an RRULE ("FREQ=MONTHLY;BYMONTHDAY=1", with or without "RRULE:").
 * Null for anything outside the supported subset, rather than guessing.
 */
export function parseRepeatRule(text: string | null | undefined): RepeatRule | null {
  if (!text) return null;
  const body = text.trim().replace(/^RRULE:/i, '');
  if (!body) return null;
  const parts = new Map<string, string>();
  for (const pair of body.split(';')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    if (!k || v === undefined || v === '') return null;
    parts.set(k.trim().toUpperCase(), v.trim().toUpperCase());
  }
  const freq = parts.get('FREQ') as RepeatFreq | undefined;
  if (!freq || !FREQS.includes(freq)) return null;
  const rule: RepeatRule = { freq, interval: 1 };
  const known = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'COUNT', 'UNTIL', 'WKST']);
  for (const k of parts.keys()) if (!known.has(k)) return null;

  const interval = parts.get('INTERVAL');
  if (interval !== undefined) {
    if (!/^\d+$/.test(interval) || +interval < 1 || +interval > 99) return null;
    rule.interval = +interval;
  }
  const count = parts.get('COUNT');
  if (count !== undefined) {
    if (!/^\d+$/.test(count) || +count < 1 || +count > 999) return null;
    rule.count = +count;
  }
  const until = parts.get('UNTIL');
  if (until !== undefined) {
    const m = /^(\d{4})-?(\d{2})-?(\d{2})(T[\dZ]*)?$/.exec(until);
    if (!m) return null;
    rule.until = `${m[1]}-${m[2]}-${m[3]}`;
  }

  const byDayRaw = parts.get('BYDAY');
  const setPos = parts.get('BYSETPOS');
  if (byDayRaw !== undefined) {
    const items = byDayRaw.split(',').map((s) => /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(s));
    if (items.some((x) => !x)) return null;
    const withNth = items.filter((x) => x![1]);
    if (withNth.length) {
      // "1SU": the first Sunday. Only one nth weekday, in a monthly or yearly rule.
      if (items.length !== 1 || setPos !== undefined || (freq !== 'MONTHLY' && freq !== 'YEARLY')) return null;
      const nth = Number(items[0]![1]);
      if (!(nth === -1 || (nth >= 1 && nth <= 5))) return null;
      rule.byNthDay = { nth, day: items[0]![2] as Weekday };
    } else if (setPos !== undefined) {
      // "BYDAY=SU;BYSETPOS=1" is another way to write the first Sunday.
      const nth = Number(setPos);
      if (items.length !== 1 || !(nth === -1 || (nth >= 1 && nth <= 5)) || (freq !== 'MONTHLY' && freq !== 'YEARLY')) return null;
      rule.byNthDay = { nth, day: items[0]![2] as Weekday };
    } else {
      if (freq !== 'WEEKLY' && freq !== 'DAILY') return null;
      if (freq === 'DAILY' && rule.interval !== 1) return null;
      const days = [...new Set(items.map((x) => x![2] as Weekday))];
      rule.byDay = WEEKDAYS.filter((d) => days.includes(d));
    }
  } else if (setPos !== undefined) {
    return null;
  }

  const byMonthDay = parts.get('BYMONTHDAY');
  if (byMonthDay !== undefined) {
    if (freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
    if (rule.byNthDay || !/^-?\d+$/.test(byMonthDay)) return null;
    const d = +byMonthDay;
    if (!(d === -1 || (d >= 1 && d <= 31))) return null;
    rule.byMonthDay = d;
  }
  const byMonth = parts.get('BYMONTH');
  if (byMonth !== undefined) {
    if (freq !== 'YEARLY' || !/^\d+$/.test(byMonth) || +byMonth < 1 || +byMonth > 12) return null;
    rule.byMonth = +byMonth;
  }
  return rule;
}

/** Write a rule back as RRULE text (no "RRULE:" prefix). */
export function formatRepeatRule(rule: RepeatRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.byNthDay) parts.push(`BYDAY=${rule.byNthDay.nth}${rule.byNthDay.day}`);
  if (rule.byMonth !== undefined) parts.push(`BYMONTH=${rule.byMonth}`);
  if (rule.byMonthDay !== undefined) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.replace(/-/g, '')}`);
  return parts.join(';');
}

/**
 * About how many days apart the repeats are, for recurrence_days: what an app
 * or server without repeat_rule falls back on. 30 a month, 365 a year.
 */
export function approxRepeatDays(rule: RepeatRule): number {
  const n = Math.max(1, rule.interval);
  switch (rule.freq) {
    case 'DAILY':
      return rule.byDay?.length ? 1 : n;
    case 'WEEKLY':
      return Math.max(1, Math.round((7 * n) / Math.max(1, rule.byDay?.length ?? 1)));
    case 'MONTHLY':
      return 30 * n;
    case 'YEARLY':
      return 365 * n;
  }
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}

/** A rule in words: "Monthly on the 1st", "Every 2 weeks on Mon, Thu", "Yearly on 1 November". */
export function repeatRuleLabel(rule: RepeatRule): string {
  const n = rule.interval;
  const every = (one: string, many: string) => (n === 1 ? one : `Every ${n} ${many}`);
  const monthPart = () => {
    if (rule.byNthDay) return `the ${NTH_WORDS[rule.byNthDay.nth]} ${WEEKDAY_NAMES[rule.byNthDay.day]}`;
    if (rule.byMonthDay === -1) return 'the last day';
    if (rule.byMonthDay !== undefined) return `the ${ordinal(rule.byMonthDay)}`;
    return '';
  };
  let label: string;
  switch (rule.freq) {
    case 'DAILY':
      label = rule.byDay?.length ? daysLabel(rule.byDay, 'Every') : every('Daily', 'days');
      break;
    case 'WEEKLY': {
      const days = rule.byDay ?? [];
      if (n === 1 && sameDays(days, ['MO', 'TU', 'WE', 'TH', 'FR'])) label = 'Every weekday';
      else if (n === 1 && days.length === 7) label = 'Daily';
      else {
        const base = n === 1 ? 'Weekly' : n === 2 ? 'Fortnightly' : `Every ${n} weeks`;
        label = days.length ? daysLabel(days, `${base} on`) : base;
      }
      break;
    }
    case 'MONTHLY': {
      const part = monthPart();
      label = every('Monthly', 'months') + (part ? ` on ${part}` : '');
      break;
    }
    case 'YEARLY': {
      const base = every('Yearly', 'years');
      if (rule.byMonth === undefined) label = base;
      else if (rule.byNthDay || rule.byMonthDay === -1) label = `${base} on ${monthPart()} of ${MONTH_NAMES[rule.byMonth - 1]}`;
      else if (rule.byMonthDay !== undefined) label = `${base} on ${rule.byMonthDay} ${MONTH_NAMES[rule.byMonth - 1]}`;
      else label = `${base} in ${MONTH_NAMES[rule.byMonth - 1]}`;
      break;
    }
  }
  if (rule.until) label += `, until ${shortDate(rule.until)}`;
  else if (rule.count !== undefined) label += rule.count === 1 ? ', last time' : `, ${rule.count} times left`;
  return label;
}

function sameDays(a: Weekday[], b: Weekday[]): boolean {
  return a.length === b.length && b.every((d) => a.includes(d));
}
function daysLabel(days: Weekday[], lead: string): string {
  if (sameDays(days, ['MO', 'TU', 'WE', 'TH', 'FR'])) return lead === 'Every' ? 'Every weekday' : `${lead} weekdays`;
  if (days.length === 1) return `${lead} ${WEEKDAY_NAMES[days[0]]}`;
  return `${lead} ${days.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(', ')}`;
}

/** How a task repeats, in words: its rule when it has one, else its day count. Null when it doesn't repeat. */
export function taskRepeatLabel(task: {
  repeat_rule?: string | null;
  recurrence_days: number | null;
}): string | null {
  const rule = parseRepeatRule(task.repeat_rule);
  if (rule) return repeatRuleLabel(rule);
  return task.recurrence_days && task.recurrence_days > 0 ? recurrenceLabel(task.recurrence_days) : null;
}
