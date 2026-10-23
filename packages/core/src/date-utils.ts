// FLUX-60: date helpers for household tasks (and, via groceries.ts, the
// groceries re-add cadence). All dates here are handled as plain YYYY-MM-DD
// strings (matching the `date` column) rather than Date objects, so
// comparisons and arithmetic are timezone safe — `new Date("2026-06-12")`
// parses as UTC midnight and silently shifts a day in non-UTC zones, which
// would mis-bucket "due today" tasks as overdue.

/** Today's local date as YYYY-MM-DD. */
export function todayISO(): string {
  return toISODate(new Date());
}

/** Format a Date as a local YYYY-MM-DD (no UTC shift). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add `days` to a YYYY-MM-DD string, returning a YYYY-MM-DD string. */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toISODate(dt);
}

/** Whole days from `fromISO` to `toISO` (positive = toISO is in the future). */
export function daysBetweenISO(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = toISO.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Whole days from today to `dateISO` (negative = past). Shared "expires in
 * Nd" / "expired Nd ago" grammar (FLUX-1554 dedup — was hand-rolled
 * identically in grocery-item-card.tsx and cost-card.tsx, risking drift).
 */
export function daysUntilISO(dateISO: string): number {
  return daysBetweenISO(todayISO(), dateISO);
}

/** Zero-pad to two digits: 7 -> "07". */
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The current local wall-clock time as HH:MM. */
/** The local YYYY-MM-DD of an instant, for a date input. */
export function localDateOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The local HH:MM of an instant, for a time input. */
export function localTimeOf(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** A local YYYY-MM-DD and HH:MM (midnight when empty) as an ISO instant. */
export function localDateTimeToISO(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = (timeStr || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

/** A repeat interval in days as words: "Weekly", "Fortnightly", "Every 3 months". */
export function recurrenceLabel(days: number): string {
  if (days % 30 === 0 && days >= 30) {
    const n = days / 30;
    return n === 1 ? 'Monthly' : `Every ${n} months`;
  }
  if (days % 7 === 0) {
    const n = days / 7;
    if (n === 1) return 'Weekly';
    if (n === 2) return 'Fortnightly';
    return `Every ${n} weeks`;
  }
  return days === 1 ? 'Daily' : `Every ${days} days`;
}

export function currentHHMM(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "14:30" -> "2:30 PM"; null or '' -> ''. */
export function formatTime12h(hhmm: string | null): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${period}`;
}

/**
 * Day label relative to today, for list group headers: "Today", "Tomorrow",
 * a weekday name within the next six days, else "Mon, Oct 20". Past dates
 * fall through to the dated form.
 */
export function formatRelativeDay(date: Date, now: Date = new Date()): string {
  const diffDays = daysBetweenISO(toISODate(now), toISODate(date));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays <= 6) return date.toLocaleDateString('en-US', { weekday: 'long' });
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * When something already happened, as a row's meta says it (H6): "Today",
 * "Yesterday", a short weekday within the past week, else "Oct 12".
 */
export function formatPastDay(date: Date, now: Date = new Date()): string {
  const ago = daysBetweenISO(toISODate(date), toISODate(now));
  if (ago <= 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  if (ago < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * A due date as a row or sheet header says it (H6): "3d overdue", "Today",
 * "Tomorrow", a short weekday inside the coming week, else "Oct 25". Never
 * the raw YYYY-MM-DD.
 */
export function dueDayLabel(dueISO: string, todayISOStr: string = todayISO()): string {
  const diff = daysBetweenISO(todayISOStr, dueISO);
  if (diff < 0) return `${-diff}d overdue`;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  const [y, m, d] = dueISO.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return diff < 7
    ? date.toLocaleDateString('en-US', { weekday: 'short' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Snooze +1h while staying on Today: add 60 minutes to the wall-clock time
 * and clamp to 23:59 if it would cross midnight (keeps the item on Today;
 * FLUX-144 due_time is wall-clock HH:MM). HOUP-120: promoted from web's
 * home/hub-shared.tsx so mobile's task snooze can share the same rule.
 */
export function addHourClampToday(base: string | null): string {
  const [h, m] = (base ?? currentHHMM()).split(':').map(Number);
  let total = h * 60 + m + 60;
  if (total >= 24 * 60) total = 24 * 60 - 1; // 23:59
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/**
 * A task snooze choice: a relative preset, or a custom YYYY-MM-DD date picked
 * by the user (taken verbatim as the new due date).
 */
export type TaskSnooze = '1h' | '1d' | '1w' | '1m' | `${number}-${number}-${number}`;

const SNOOZE_DAYS: Record<'1d' | '1w' | '1m', number> = { '1d': 1, '1w': 7, '1m': 30 };

/**
 * The task patch a snooze choice resolves to, shared by web and mobile so
 * every snooze surface (swipe undercard, quick menu, Home hero) agrees. 1h
 * nudges the time and stays on Today; 1d/1w/1m push the due date forward from
 * the current one (or today when undated); a custom date replaces it. "1
 * month" is 30 days, matching the groceries snooze and the Monthly repeat.
 */
export function taskSnoozePatch(
  task: { due_date: string | null; due_time: string | null },
  dur: TaskSnooze,
  today: string = todayISO(),
): { due_date?: string; due_time?: string } {
  if (dur === '1h') return { due_time: addHourClampToday(task.due_time) };
  if (dur === '1d' || dur === '1w' || dur === '1m') {
    return { due_date: addDaysISO(task.due_date ?? today, SNOOZE_DAYS[dur]) };
  }
  return { due_date: dur };
}

/** Undo pill label after a snooze, shared by web and mobile. */
export function taskSnoozeUndoLabel(count: number): string {
  return count === 1 ? 'Task snoozed' : `${count} tasks snoozed`;
}
