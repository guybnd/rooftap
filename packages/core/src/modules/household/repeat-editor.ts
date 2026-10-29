// The task editor's Repeat field, shared by web and phone: the smart list
// built from the due date ("Monthly on the 1st", "Monthly on the first
// Sunday"), the Custom builder's state, and the "Next:" preview. Screens only
// lay these out. Rules are in ./repeat-rule.

import {
  WEEKDAYS,
  anchorRepeatRule,
  approxRepeatDays,
  firstRepeatDate,
  formatRepeatRule,
  nextRepeatDate,
  parseRepeatRule,
  repeatRuleLabel,
  taskRepeatLabel,
  weekdayOf,
  type RepeatRule,
  type Weekday,
} from './repeat-rule';

/** What a task row stores about repeating. */
export interface TaskRepeatFields {
  recurrence_days: number | null;
  repeat_rule?: string | null;
}

/**
 * The fields to write for a repeat choice. repeat_rule is only present when
 * the server has the column (see repeatChoices' `rules`), so an older server
 * never gets a field it would reject.
 */
export type TaskRepeatPatch = TaskRepeatFields;

export interface RepeatChoice {
  id: string;
  label: string;
  patch: TaskRepeatPatch;
}

const NTH_WORDS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' };
const WEEKDAY_NAMES: Record<Weekday, string> = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
};
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_SHORT: Record<Weekday, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };

function dayOf(iso: string): number {
  return Number(iso.slice(8, 10));
}
function monthOf(iso: string): number {
  return Number(iso.slice(5, 7));
}
function isLastDay(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  return d === new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** The date's place among its weekday in the month: 1 to 4, or -1 when it is the last (a fifth). */
function nthOf(iso: string): number {
  const n = Math.ceil(dayOf(iso) / 7);
  return n >= 5 ? -1 : n;
}

export function rulePatch(rule: RepeatRule): TaskRepeatPatch {
  return { recurrence_days: approxRepeatDays(rule), repeat_rule: formatRepeatRule(rule) };
}
function nonePatch(rules: boolean): TaskRepeatPatch {
  return rules ? { recurrence_days: null, repeat_rule: null } : { recurrence_days: null };
}

/**
 * The Repeat list for a task due on `dueDate` (today when it has none). With
 * `rules` false (a server older than the repeat_rule column) it is the old
 * day-count list. Custom is the screen's own row, not in this list.
 */
export function repeatChoices(dueDate: string | null, today: string, rules: boolean): RepeatChoice[] {
  if (!rules) {
    return [
      { id: 'none', label: 'Does not repeat', patch: nonePatch(false) },
      { id: 'daily', label: 'Daily', patch: { recurrence_days: 1 } },
      { id: 'weekly', label: 'Weekly', patch: { recurrence_days: 7 } },
      { id: 'fortnightly', label: 'Fortnightly', patch: { recurrence_days: 14 } },
      { id: 'monthly', label: 'Every 30 days', patch: { recurrence_days: 30 } },
    ];
  }
  const due = dueDate || today;
  const wd = weekdayOf(due);
  const rules_: { id: string; rule: RepeatRule }[] = [
    { id: 'daily', rule: { freq: 'DAILY', interval: 1 } },
    { id: 'weekly', rule: { freq: 'WEEKLY', interval: 1, byDay: [wd] } },
    { id: 'fortnightly', rule: { freq: 'WEEKLY', interval: 2, byDay: [wd] } },
    { id: 'monthly-day', rule: { freq: 'MONTHLY', interval: 1, byMonthDay: dayOf(due) } },
    { id: 'monthly-nth', rule: { freq: 'MONTHLY', interval: 1, byNthDay: { nth: nthOf(due), day: wd } } },
  ];
  if (isLastDay(due)) rules_.push({ id: 'monthly-last', rule: { freq: 'MONTHLY', interval: 1, byMonthDay: -1 } });
  rules_.push(
    { id: 'yearly', rule: { freq: 'YEARLY', interval: 1, byMonth: monthOf(due), byMonthDay: dayOf(due) } },
    { id: 'weekdays', rule: { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] } },
  );
  return [
    { id: 'none', label: 'Does not repeat', patch: nonePatch(true) },
    ...rules_.map(({ id, rule }) => ({ id, label: repeatRuleLabel(rule), patch: rulePatch(rule) })),
  ];
}

/** Which choice a task's repeat matches, or null (a custom rule, or an old day count the list no longer has). */
export function selectedRepeatChoice(task: TaskRepeatFields, choices: RepeatChoice[]): string | null {
  const rule = parseRepeatRule(task.repeat_rule);
  if (rule) {
    const text = formatRepeatRule(rule);
    return choices.find((c) => c.patch.repeat_rule === text)?.id ?? null;
  }
  const days = task.recurrence_days && task.recurrence_days > 0 ? task.recurrence_days : null;
  return choices.find((c) => !c.patch.repeat_rule && c.patch.recurrence_days === days)?.id ?? null;
}

/** The Repeat field's value: the rule in words, the old day count, or "Does not repeat". */
export function repeatValueLabel(task: TaskRepeatFields): string {
  return taskRepeatLabel(task) ?? 'Does not repeat';
}

/** Up to `n` dates after `dueDate` the repeat falls on, for "Next: 1 Dec, 1 Jan, 1 Feb". */
export function repeatPreview(task: TaskRepeatFields, dueDate: string | null, today: string, n = 3): string[] {
  const out: string[] = [];
  const rule = parseRepeatRule(task.repeat_rule);
  let at = dueDate || today;
  let left = rule?.count;
  for (let i = 0; i < n; i++) {
    if (rule) {
      if (left !== undefined && left <= 1) break;
      const next = nextRepeatDate(rule, at);
      if (!next) break;
      at = next;
      if (left !== undefined) left--;
    } else if (task.recurrence_days && task.recurrence_days > 0) {
      const [y, m, d] = at.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d + task.recurrence_days));
      at = dt.toISOString().slice(0, 10);
    } else break;
    out.push(at);
  }
  return out;
}

/** "Sun 6 Dec", with the year when it isn't this year's. */
export function repeatDateLabel(iso: string, today: string): string {
  const wd = WEEKDAYS_SHORT[weekdayOf(iso)];
  const base = `${wd} ${dayOf(iso)} ${MONTHS_SHORT[monthOf(iso) - 1]}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${iso.slice(0, 4)}`;
}

// ---- Custom builder ----

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';
export type RepeatMonthMode = 'day' | 'nth' | 'last';
export type RepeatEnd = 'never' | 'until' | 'count';

export interface RepeatDraft {
  unit: RepeatUnit;
  interval: number;
  /** Week: the days it falls on. */
  weekDays: Weekday[];
  /** Month and year: by date, by nth weekday, or the last day. */
  monthMode: RepeatMonthMode;
  end: RepeatEnd;
  /** YYYY-MM-DD, used when end is 'until'. */
  until: string;
  /** Times, used when end is 'count'. */
  count: number;
}

export const REPEAT_UNIT_OPTIONS: { value: RepeatUnit; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];
export const REPEAT_END_OPTIONS: { value: RepeatEnd; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'until', label: 'On a date' },
  { value: 'count', label: 'After' },
];
/** Weekday chips, Monday first: value plus a one-letter label. */
export const REPEAT_WEEKDAY_OPTIONS: { value: Weekday; label: string; name: string }[] = WEEKDAYS.map((d) => ({
  value: d,
  label: WEEKDAY_NAMES[d][0],
  name: WEEKDAY_NAMES[d],
}));

const FREQ_UNIT: Record<RepeatRule['freq'], RepeatUnit> = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' };
const UNIT_FREQ: Record<RepeatUnit, RepeatRule['freq']> = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' };

function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, 1));
  const dim = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, dim));
  return dt.toISOString().slice(0, 10);
}

/** The builder's starting state for a task's repeat (monthly, ending never, when it has none). */
export function repeatDraftFrom(task: TaskRepeatFields, dueDate: string | null, today: string): RepeatDraft {
  const due = dueDate || today;
  const draft: RepeatDraft = {
    unit: 'month',
    interval: 1,
    weekDays: [weekdayOf(due)],
    monthMode: 'day',
    end: 'never',
    until: addMonthsISO(due, 6),
    count: 12,
  };
  const rule = parseRepeatRule(task.repeat_rule);
  if (!rule) {
    const days = task.recurrence_days;
    if (days && days > 0) {
      if (days % 7 === 0) Object.assign(draft, { unit: 'week', interval: days / 7 });
      else Object.assign(draft, { unit: 'day', interval: days });
    }
    return draft;
  }
  draft.unit = FREQ_UNIT[rule.freq];
  draft.interval = rule.interval;
  if (rule.byDay?.length) draft.weekDays = rule.byDay;
  if (rule.freq === 'DAILY' && rule.byDay?.length) draft.unit = 'week';
  draft.monthMode = rule.byNthDay ? 'nth' : rule.byMonthDay === -1 ? 'last' : 'day';
  if (rule.until) Object.assign(draft, { end: 'until', until: rule.until });
  else if (rule.count !== undefined) Object.assign(draft, { end: 'count', count: rule.count });
  return draft;
}

/** The rule the builder describes, anchored on the due date. */
export function repeatRuleFromDraft(draft: RepeatDraft, dueDate: string | null, today: string): RepeatRule {
  const due = dueDate || today;
  const rule: RepeatRule = { freq: UNIT_FREQ[draft.unit], interval: Math.min(99, Math.max(1, Math.round(draft.interval) || 1)) };
  if (draft.unit === 'week') rule.byDay = draft.weekDays.length ? WEEKDAYS.filter((d) => draft.weekDays.includes(d)) : [weekdayOf(due)];
  if (draft.unit === 'month' || draft.unit === 'year') {
    if (draft.monthMode === 'nth') rule.byNthDay = { nth: nthOf(due), day: weekdayOf(due) };
    else if (draft.monthMode === 'last') rule.byMonthDay = -1;
    else rule.byMonthDay = dayOf(due);
    if (draft.unit === 'year') rule.byMonth = monthOf(due);
  }
  if (draft.end === 'until' && draft.until) rule.until = draft.until;
  if (draft.end === 'count') rule.count = Math.min(999, Math.max(1, Math.round(draft.count) || 1));
  return anchorRepeatRule(rule, due);
}

/** The builder's "On" choices for a month or year, worded from the due date: "Day 1", "The first Sunday", "The last day". */
export function repeatMonthModeOptions(dueDate: string | null, today: string): { value: RepeatMonthMode; label: string }[] {
  const due = dueDate || today;
  return [
    { value: 'day', label: `Day ${dayOf(due)}` },
    { value: 'nth', label: `The ${NTH_WORDS[nthOf(due)]} ${WEEKDAY_NAMES[weekdayOf(due)]}` },
    { value: 'last', label: 'The last day' },
  ];
}


/**
 * Keep a picked choice when the due date moves: "Weekly on Sunday" becomes
 * "Weekly on Monday" when the task moves to a Monday, as Google Calendar does.
 * A custom rule, or no repeat, stays as it is.
 */
export function repeatFollowDue(
  value: TaskRepeatFields,
  oldDue: string | null,
  newDue: string | null,
  today: string,
  rules: boolean,
): TaskRepeatFields {
  if (!rules || !value.repeat_rule) return value;
  const id = selectedRepeatChoice(value, repeatChoices(oldDue, today, true));
  if (!id || id === 'none') return value;
  return repeatChoices(newDue, today, true).find((c) => c.id === id)?.patch ?? value;
}

/**
 * The fields a save writes: the picked repeat, plus a due date when a rule
 * needs one (a repeating task with no date starts on the rule's first day).
 */
export function repeatSaveFields(
  value: TaskRepeatFields,
  dueDate: string | null,
  today: string,
): TaskRepeatFields & { due_date: string | null } {
  const rule = parseRepeatRule(value.repeat_rule);
  const due = !dueDate && rule ? firstRepeatDate(rule, today) : dueDate;
  return { ...value, due_date: due };
}

/** A task's repeat fields, with repeat_rule only when its row has the column. */
export function taskRepeatFields(task: TaskRepeatFields): TaskRepeatFields {
  return task.repeat_rule !== undefined
    ? { recurrence_days: task.recurrence_days, repeat_rule: task.repeat_rule }
    : { recurrence_days: task.recurrence_days };
}
