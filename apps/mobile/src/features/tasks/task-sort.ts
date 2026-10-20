// HOUP-220: pure task-list comparator, extracted so the ordering rules are
// testable without rendering the screen. Mirrors apps/web/src/app/tasks/page.tsx's
// tasks$ sort exactly — date asc → all-day before timed → time asc → sort_order.
import type { HouseholdTask } from '@homeup/core';

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
