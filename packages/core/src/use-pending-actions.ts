'use client';

// HOUP-245: React glue for pending-actions.ts. Kept separate from the pure
// trackers so those stay unit-testable with zero React import. Both apps/web
// and apps/mobile use these identically (useSyncExternalStore is available
// on both React DOM and React Native).

import { useSyncExternalStore } from 'react';
import type { PendingActionTracker } from './pending-actions';

/** Live-reads a PendingActionTracker's pending id set, re-rendering on schedule/cancel/expire. */
export function usePendingIds(tracker: PendingActionTracker): ReadonlySet<string> {
  return useSyncExternalStore(tracker.subscribe, tracker.pendingIds, tracker.pendingIds);
}
