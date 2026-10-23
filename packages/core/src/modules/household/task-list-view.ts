// What the Tasks list shows, shared by the web page and the mobile tab: the
// list order, the By person groups, the move-in countdown, the checklist
// lookups each row needs, and the snooze Undo pill. Each app keeps its own
// rendering and its own toast. Due-date bucketing is bucketTasksByDueDate in
// household-tasks.ts.

import type { Checklist, ChecklistTaskItem, HouseholdTask } from '../../types';
import { daysBetweenISO, taskSnoozePatch, taskSnoozeUndoLabel, todayISO, type TaskSnooze } from '../../date-utils';

/** The list order: date ascending, all-day before timed, then time, then the user's own order. Undated last. */
export function compareTasksByDueDateTimeOrder(a: HouseholdTask, b: HouseholdTask): number {
  if (!a.due_date && !b.due_date) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
  const at = a.due_time ?? '';
  const bt = b.due_time ?? '';
  if (!at && bt) return -1;
  if (at && !bt) return 1;
  if (at !== bt) return at < bt ? -1 : 1;
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

/** Within one person's group: open tasks first, then by due date and time (all-day first). Undated last. */
export function compareTasksForPerson(a: HouseholdTask, b: HouseholdTask): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (!a.due_date) return b.due_date ? 1 : 0;
  if (!b.due_date) return -1;
  if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
  const at = a.due_time ?? '';
  const bt = b.due_time ?? '';
  return at < bt ? -1 : at > bt ? 1 : 0;
}

export interface TaskPersonGroup {
  /** The assignee's user id, or 'unassigned'. */
  key: string;
  tasks: HouseholdTask[];
}

/**
 * The By person view (FLUX-142): you first, then the other members in board
 * order, then anyone else assigned, Unassigned last. Each group is sorted by
 * compareTasksForPerson. The caller filters out what it hides first.
 */
export function groupTasksByPerson(
  tasks: HouseholdTask[],
  currentUserId: string | null | undefined,
  memberIds: string[]
): TaskPersonGroup[] {
  const byPerson = new Map<string, HouseholdTask[]>();
  for (const t of tasks) {
    const key = t.assigned_to ?? 'unassigned';
    const list = byPerson.get(key) ?? [];
    list.push(t);
    byPerson.set(key, list);
  }
  const orderedKeys = [
    ...(currentUserId && byPerson.has(currentUserId) ? [currentUserId] : []),
    ...memberIds.filter((id) => id !== currentUserId && byPerson.has(id)),
    ...[...byPerson.keys()].filter((k) => k !== 'unassigned' && k !== currentUserId && !memberIds.includes(k)),
    ...(byPerson.has('unassigned') ? ['unassigned'] : []),
  ];
  return orderedKeys.map((key) => ({ key, tasks: [...byPerson.get(key)!].sort(compareTasksForPerson) }));
}

/** The move-in countdown card: "12 days until move-in" over "Wed, Nov 11" (H6, never the raw date). */
export function moveInCountdown(
  moveInDate: string | null | undefined,
  today: string = todayISO()
): { label: string; sub: string } | null {
  if (!moveInDate) return null;
  const sub = new Date(`${moveInDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const d = daysBetweenISO(today, moveInDate);
  if (d > 0) return { label: `${d} day${d === 1 ? '' : 's'} until move-in`, sub };
  if (d === 0) return { label: 'Move-in day is today', sub };
  const ago = Math.abs(d);
  return { label: `Moved in ${ago} day${ago === 1 ? '' : 's'} ago`, sub };
}

/** Checklists by id, for the checklist chip on a task row. */
export function checklistsById(checklists: Checklist[]): Record<string, Checklist> {
  const map: Record<string, Checklist> = {};
  for (const cl of checklists) map[cl.id] = cl;
  return map;
}

/** Checklist items grouped by checklist, each list in its own order. */
export function checklistItemsByChecklistId(items: ChecklistTaskItem[]): Record<string, ChecklistTaskItem[]> {
  const map: Record<string, ChecklistTaskItem[]> = {};
  for (const item of items) (map[item.checklist_id] ??= []).push(item);
  for (const list of Object.values(map)) list.sort((a, b) => a.order - b.order);
  return map;
}

/** The part of each app's undo-toast presenter the snooze uses. */
export type TaskUndoPresenterFactory = (options: {
  message: (count: number, latest: HouseholdTask) => string;
  apply: (id: string, patch: Partial<HouseholdTask>) => void;
}) => { run(rows: HouseholdTask, patch: Partial<HouseholdTask>): void };

/** Swipe or menu snooze with an Undo pill that puts the due date and time back. */
export function createTaskSnoozeUndo(
  createPresenter: TaskUndoPresenterFactory,
  apply: (id: string, patch: Partial<HouseholdTask>) => void
) {
  const presenter = createPresenter({ message: (count) => taskSnoozeUndoLabel(count), apply });
  return (task: HouseholdTask, dur: TaskSnooze, today?: string) => presenter.run(task, taskSnoozePatch(task, dur, today));
}
