// HOUP-81: pure household-task derivation shared by apps/web/src/app/tasks
// (via moving-tasks.ts's re-export) and apps/mobile/src/app/tasks. Extracted
// from apps/web/src/app/tasks/page.tsx + moving-tasks.ts's nextOccurrenceISO —
// no behavior change on web, native's Tasks screen is the first new consumer.

import { addDaysISO, todayISO } from './date-utils';
import type { HouseholdTask } from './types';

/**
 * Compute the next occurrence date for a recurring task on completion. Bases
 * off the task's due_date when set (else today), advances by
 * recurrence_days, and rolls forward so the next occurrence is never in the
 * past.
 */
export function nextOccurrenceISO(dueDate: string | null, recurrenceDays: number): string {
  const today = todayISO();
  let next = addDaysISO(dueDate ?? today, recurrenceDays);
  // Guard against pathological input and avoid an infinite loop.
  if (recurrenceDays > 0) {
    while (next < today) next = addDaysISO(next, recurrenceDays);
  }
  return next;
}

export interface TaskCompletionResult {
  /** Patch to apply to the source task via patchRow/`.assign()`. */
  update: Pick<HouseholdTask, 'done' | 'completed_at'>;
  /** Full row to create via writeRow when the source task recurs; null otherwise. */
  createNextOccurrence: HouseholdTask | null;
}

/**
 * HOUP-110: single explicit-target completion helper shared by every toggle
 * call site (mobile Tasks screen, mobile Home hero, the Android widget's
 * headless handler) — takes the target state the caller already decided on,
 * never infers an inverse from the task's current state. `nextId` must be
 * caller-supplied (not generated here) so a replayed durable event reuses the
 * same id instead of creating a second occurrence.
 */
export function applyTaskCompletion(
  task: HouseholdTask,
  targetDone: boolean,
  opts: { nextId: string; now?: Date },
): TaskCompletionResult {
  if (!targetDone) {
    return { update: { done: false, completed_at: null }, createNextOccurrence: null };
  }

  const now = opts.now ?? new Date();
  let createNextOccurrence: HouseholdTask | null = null;
  if (task.recurrence_days && task.recurrence_days > 0) {
    const next = nextOccurrenceISO(task.due_date, task.recurrence_days);
    createNextOccurrence = {
      id: opts.nextId,
      group_id: task.group_id,
      title: task.title,
      due_date: next,
      due_time: task.due_time,
      offset_days: null,
      recurrence_days: task.recurrence_days,
      done: false,
      completed_at: null,
      assigned_to: task.assigned_to,
      private: task.private,
      template_key: null,
      notes: task.notes,
      sort_order: task.sort_order,
      priority: task.priority,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    };
  }
  return { update: { done: true, completed_at: now.toISOString() }, createNextOccurrence };
}

/** A task row's inline-editable fields (title, due date, notes). */
export type TaskEditableField = 'title' | 'due_date' | 'notes';

/**
 * The patch an inline edit of one task field writes, or null when the edit is
 * a no-op (an empty title). An empty due date or notes clears the field.
 * Hand-setting the due date of a moving-template task (offset-based)
 * detaches it from the template, so it's never re-flagged as out of sync with
 * the move-in date; a reminder task (no offset) keeps its template_key so its
 * origin backlink survives. Shared by every native TaskRow owner (the Tasks
 * screen, the capture sheet's search results); web's TaskRow applies the
 * same rule inside the row.
 */
export function taskFieldPatch(task: HouseholdTask, field: TaskEditableField, value: string): Partial<HouseholdTask> | null {
  if (field === 'title') {
    const title = value.trim();
    return title ? { title } : null;
  }
  if (field === 'due_date') {
    const patch: Partial<HouseholdTask> = { due_date: value || null };
    if (task.template_key && task.offset_days != null) {
      patch.template_key = null;
      patch.offset_days = null;
    }
    return patch;
  }
  return { notes: value.trim() || null };
}

export interface HouseholdTaskBuckets {
  overdue: HouseholdTask[];
  thisWeek: HouseholdTask[];
  upcoming: HouseholdTask[];
  done: HouseholdTask[];
}

/**
 * Buckets tasks by due date (overdue / this week / upcoming), separating
 * completed tasks into their own bucket. Mirrors apps/web/src/app/tasks/page.tsx's
 * inline bucketing loop.
 */
export function bucketTasksByDueDate(tasks: HouseholdTask[]): HouseholdTaskBuckets {
  const today = todayISO();
  const weekOut = addDaysISO(today, 7);
  const buckets: HouseholdTaskBuckets = { overdue: [], thisWeek: [], upcoming: [], done: [] };
  for (const t of tasks) {
    if (t.done) buckets.done.push(t);
    else if (!t.due_date) buckets.upcoming.push(t);
    else if (t.due_date < today) buckets.overdue.push(t);
    else if (t.due_date <= weekOut) buckets.thisWeek.push(t);
    else buckets.upcoming.push(t);
  }
  return buckets;
}

/** How far ahead the Upcoming bucket reaches when the user hasn't picked a window. */
export const DEFAULT_UPCOMING_WINDOW_DAYS = 90;

/** The user's Upcoming window in days (user_settings.tasks_upcoming_days), falling back to the default. */
export function upcomingWindowDays(settings: { tasks_upcoming_days?: number | null } | null | undefined): number {
  const v = settings?.tasks_upcoming_days;
  return v != null && Number.isFinite(v) && v > 0 ? Math.round(v) : DEFAULT_UPCOMING_WINDOW_DAYS;
}

/**
 * Splits the Upcoming bucket at the user's window: tasks due within `days` of
 * today stay in Upcoming, tasks due further out move to `later` (shown behind
 * a collapsed "Later" group). Undated tasks always stay in Upcoming.
 */
export function splitUpcomingByWindow(
  upcoming: HouseholdTask[],
  days: number,
  today: string = todayISO()
): { upcoming: HouseholdTask[]; later: HouseholdTask[] } {
  const cutoff = addDaysISO(today, days);
  const within: HouseholdTask[] = [];
  const later: HouseholdTask[] = [];
  for (const t of upcoming) {
    if (t.due_date && t.due_date > cutoff) later.push(t);
    else within.push(t);
  }
  return { upcoming: within, later };
}

/**
 * Free-form "every N days/weeks/months" recurrence editing. HOUP-120:
 * promoted from apps/web/src/app/tasks/household-task-modal.tsx (was
 * web-only, un-shared) so apps/mobile's task modal can gain the same custom
 * cadence input apps/web already has, instead of only the 5 fixed presets.
 */
export type RecurrenceUnit = 'days' | 'weeks' | 'months';

export const UNIT_DAYS: Record<RecurrenceUnit, number> = { days: 1, weeks: 7, months: 30 };

export const UNIT_OPTIONS: { value: RecurrenceUnit; label: string }[] = [
  { value: 'days', label: 'Day' },
  { value: 'weeks', label: 'Week' },
  { value: 'months', label: 'Month' },
];

/** Convert a stored recurrence_days value back into the most natural count + unit. */
export function splitRecurrence(days: number | null): { count: number | null; unit: RecurrenceUnit } {
  if (!days || days <= 0) return { count: null, unit: 'weeks' };
  if (days % 30 === 0) return { count: days / 30, unit: 'months' };
  if (days % 7 === 0) return { count: days / 7, unit: 'weeks' };
  return { count: days, unit: 'days' };
}
