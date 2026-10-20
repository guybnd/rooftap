// HOUP-327: pure view helpers for the checklist detail screens — sort modes,
// the "completed to bottom" partition, and the account-default-with-fallback
// rule. Side-effect-free (mirrors checklists.ts's own contract): builds
// derived arrays, never writes to a store. Both detail screens (web + native)
// share these so sort/partition logic can't fork between platforms.

import { compareStrings } from './sort';
import type { ChecklistTaskItem, ChecklistType } from './types';

export const CHECKLIST_SORT_MODES = ['manual', 'alpha', 'price', 'recent'] as const;
export type ChecklistSortMode = (typeof CHECKLIST_SORT_MODES)[number];

export const CHECKLIST_SORT_LABELS: Record<ChecklistSortMode, string> = {
  manual: 'Manual',
  alpha: 'A to Z',
  price: 'Price',
  recent: 'Recently checked',
};

/** Price only makes sense for a Shopping list — every other type omits it. */
export function availableSortModes(type: ChecklistType): ChecklistSortMode[] {
  return type === 'shopping'
    ? [...CHECKLIST_SORT_MODES]
    : CHECKLIST_SORT_MODES.filter((m) => m !== 'price');
}

/**
 * Resolves a stored sort mode (account default or per-list override) against
 * what this list TYPE actually offers. An account default of Price applied to
 * a plain/repeating list — or any unrecognised/legacy value — falls back to
 * Manual, so the sort menu always has exactly one mode checked.
 */
export function resolveSortMode(
  stored: string | null | undefined,
  type: ChecklistType,
): ChecklistSortMode {
  const available = availableSortModes(type);
  return (available as string[]).includes(stored ?? '') ? (stored as ChecklistSortMode) : 'manual';
}

function priceDesc(a: ChecklistTaskItem, b: ChecklistTaskItem): number {
  const av = a.cost_cents;
  const bv = b.cost_cents;
  if (av == null && bv == null) return 0;
  if (av == null) return 1; // nulls last
  if (bv == null) return -1;
  return bv - av;
}

function recentDesc(a: ChecklistTaskItem, b: ChecklistTaskItem): number {
  const av = a.checked_at;
  const bv = b.checked_at;
  if (av == null && bv == null) return 0;
  if (av == null) return 1; // unchecked last
  if (bv == null) return -1;
  return bv.localeCompare(av); // ISO strings — lexical compare = chronological
}

/**
 * Sort a projection for display. NEVER mutates `order` — this is a view over
 * the existing rows, and every mode tie-breaks on `order` so a manual-order
 * relationship survives underneath any active sort (D2).
 */
export function sortItems(
  items: ChecklistTaskItem[],
  mode: ChecklistSortMode,
): ChecklistTaskItem[] {
  const sorted = [...items];
  switch (mode) {
    case 'alpha':
      sorted.sort((a, b) => compareStrings(a.label, b.label) || a.order - b.order);
      break;
    case 'price':
      sorted.sort((a, b) => priceDesc(a, b) || a.order - b.order);
      break;
    case 'recent':
      sorted.sort((a, b) => recentDesc(a, b) || a.order - b.order);
      break;
    case 'manual':
    default:
      sorted.sort((a, b) => a.order - b.order);
      break;
  }
  return sorted;
}

/**
 * Splits a (possibly already-sorted) projection into open/done. Open rows keep
 * input order; done rows are newest-checked first whatever the sort, so the
 * item just ticked lands at the top of the Completed band, right where an
 * undo reaches for it. Done rows with no `checked_at` (ticked before it was
 * stamped) follow, in input order.
 */
export function partitionDone(items: ChecklistTaskItem[]): {
  open: ChecklistTaskItem[];
  done: ChecklistTaskItem[];
} {
  const open: ChecklistTaskItem[] = [];
  const done: ChecklistTaskItem[] = [];
  for (const item of items) {
    (item.is_done ? done : open).push(item);
  }
  // Array#sort is stable, so equal stamps keep their input order.
  done.sort(recentDesc);
  return { open, done };
}
