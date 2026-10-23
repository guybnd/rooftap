// H6: a cost's date as a relative day, never "7 Oct" or raw ISO. Same grammar
// as the task row's due label: Today / Tomorrow / Yesterday, a short weekday
// inside the coming week, then "Oct 25". Both apps' cost rows use these.

import type { CostItem } from '../../types';
import { daysBetweenISO, toISODate } from '../../date-utils';
import { timeAgo } from '../../relative-time';
import { isOneOff, nextOccurrence, parseLocalDateOnly } from './costs';

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

/** The cost's contract or discount end, whichever comes first, and the days left to it. */
export function soonestCostExpiry(
  item: Pick<CostItem, 'end_date' | 'discount_end_date'>,
  now: Date = new Date()
): { kind: 'Contract' | 'Discount'; date: string; days: number } | null {
  const candidates: { kind: 'Contract' | 'Discount'; date: string }[] = [];
  if (item.end_date) candidates.push({ kind: 'Contract', date: item.end_date });
  if (item.discount_end_date) candidates.push({ kind: 'Discount', date: item.discount_end_date });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.date.localeCompare(b.date));
  const soonest = candidates[0];
  return { ...soonest, days: daysBetweenISO(toISODate(now), soonest.date) };
}

/**
 * A cost row's date: a one-off's date, else the recurring cost's next date
 * from this month, else "added 3d ago" from created_at. Local-first inserts
 * can lack both, so this can be null.
 */
export function costRowDateLabel(item: CostItem, now: Date = new Date()): string | null {
  if (item.start_date) {
    const occurrence = isOneOff(item) ? parseLocalDateOnly(item.start_date) : nextOccurrence(item, new Date(now.getFullYear(), now.getMonth(), 1));
    if (occurrence) return costDateLabel(occurrence, now);
  }
  if (item.created_at) {
    const rel = timeAgo(item.created_at);
    if (rel) return `added ${rel}`;
  }
  return null;
}
