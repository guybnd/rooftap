// HOUP-88: shared status/priority vocabulary for the Home Setup section,
// relocated from apps/web/src/app/setup/setup-status.ts so web and native
// speak the same status order/labels and roll up items the same way.
// Tailwind/NativeWind visual class maps (fills, pills, dots) stay
// screen-local on each platform — they're styling, not logic.
import type { SetupItem } from '../../types';

export const STATUS_ORDER = ['needed', 'installed'] as const;
export type SetupStatus = (typeof STATUS_ORDER)[number];

export const PRIORITY_ORDER = ['low', 'medium', 'high'] as const;
export type SetupPriority = (typeof PRIORITY_ORDER)[number];

// Named SETUP_STATUS_LABEL, not STATUS_LABEL — groceries.ts already exports a
// STATUS_LABEL for its own (unrelated) status vocabulary, and `export *`
// barrels can't carry two same-named exports.
export const SETUP_STATUS_LABEL: Record<SetupStatus, string> = {
  needed: 'Needed',
  installed: 'Got it',
};

export const PRIORITY_LABEL: Record<SetupPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/** The other status — a simple two-way toggle (FLUX-240: 2-status model). */
export function nextStatus(status: string): SetupStatus {
  const idx = STATUS_ORDER.indexOf(status as SetupStatus);
  return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
}

export interface SetupSummary {
  total: number;
  counts: Record<string, number>;
  est: number;
  spent: number;
  outstanding: number; // still "needed"
}

/** Roll up a list of items into counts + budget totals. */
export function summarize(items: SetupItem[]): SetupSummary {
  const counts: Record<string, number> = {};
  let est = 0;
  let spent = 0;
  let outstanding = 0;
  for (const i of items) {
    counts[i.status] = (counts[i.status] ?? 0) + 1;
    est += i.est_price || 0;
    if (i.status === 'installed') {
      spent += i.actual_price || 0;
    } else {
      outstanding += 1;
    }
  }
  return { total: items.length, counts, est, spent, outstanding };
}
