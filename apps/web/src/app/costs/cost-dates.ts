// H6: a cost's date as a relative day, never "7 Oct" or raw ISO. Same grammar
// as the task row's due label (apps/web/src/app/tasks/task-row.tsx dueMeta):
// Today / Tomorrow / Yesterday, a short weekday inside the coming week, then
// "Oct 25". Native mirrors it in apps/mobile/src/features/costs/cost-card.tsx.
import { daysBetweenISO, toISODate } from '@homeup/core';

export function costDateLabel(d: Date, now: Date = new Date()): string {
  const diff = daysBetweenISO(toISODate(now), toISODate(d));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** An expiry fragment for a cost row ("Discount ends in 20d", "Contract ended 3d ago"). */
export function expiryLabel(kind: 'Contract' | 'Discount', days: number): string {
  if (days < 0) return `${kind} ended ${Math.abs(days)}d ago`;
  if (days === 0) return `${kind} ends today`;
  return `${kind} ends in ${days}d`;
}
