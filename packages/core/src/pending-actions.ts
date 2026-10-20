// HOUP-245: shared undo-affordance primitive. Two pure, framework-agnostic
// state machines — no React, no RN, no DOM — so both platforms drive the
// same logic instead of reimplementing "start a grace-period timer" per
// screen. Rendering (list filtering, toast/pill) stays in each surface;
// only the timing/coalescing state lives here. See use-pending-actions.ts
// for the React (useSyncExternalStore) adapters both platforms share.
//
// Design decisions (recorded here so they aren't re-litigated per surface):
// - Grace window: 4000ms — matches the existing toast default
//   (packages/ui/src/lib/toast-store.ts's DEFAULT_DURATION_MS) so "linger"
//   and "undo pill" read as the same window across the app.
// - Per-item timers for tick-off (createPendingActionTracker): ticking off
//   item B never resets item A's window. Re-toggling the SAME item within
//   its own window cancels only that item's timer.
// - Backgrounding mid-window: the underlying field mutation (done/status/
//   deleted) already happens immediately when the surface calls the normal
//   patch/toggle — the grace period only delays when the *view* stops
//   showing it. So a killed timer (app backgrounded, tab discarded) can
//   never lose or half-apply a change: worst case the item just never gets
//   its delayed re-filter and disappears immediately next time the list
//   re-renders from the committed data, matching "commit rather than
//   silently revert".
// - Delete-undo pills coalesce (createUndoBatchTracker): rapid deletes
//   within the window collapse into one pill with a running count; each
//   new delete restarts the *shared* batch timer (one pill, one window,
//   not N stacked pills).

export type Unsubscribe = () => void;

export const DEFAULT_PENDING_DELAY_MS = 4000;

export interface PendingActionTracker {
  /**
   * Marks `id` pending and schedules `onExpire` after `delayMs`. Calling this
   * again for the same `id` restarts *only that item's* timer (no cross-item
   * coupling) — this is how "re-tap within the window" cleanly reverts.
   */
  schedule(id: string, onExpire: () => void, delayMs?: number): void;
  /** Cancels a pending id's timer. Does NOT call onExpire. No-op if not pending. */
  cancel(id: string): void;
  isPending(id: string): boolean;
  pendingIds(): ReadonlySet<string>;
  subscribe(listener: () => void): Unsubscribe;
}

/** Per-item independent grace-period timers — drives the tick-off "linger" filter. */
export function createPendingActionTracker(): PendingActionTracker {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const ids = new Set<string>();
  // Immutable snapshot, rebuilt (new reference) on every mutation so
  // useSyncExternalStore's Object.is check detects a change — see
  // usePendingIds in use-pending-actions.ts. `ids` above stays the mutable
  // working set; `snapshot` is what callers/readers observe.
  let snapshot: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();

  function emit(): void {
    snapshot = new Set(ids);
    listeners.forEach((listener) => listener());
  }

  function cancel(id: string): void {
    const timer = timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(id);
    ids.delete(id);
    emit();
  }

  function schedule(id: string, onExpire: () => void, delayMs: number = DEFAULT_PENDING_DELAY_MS): void {
    const existing = timers.get(id);
    if (existing !== undefined) clearTimeout(existing);
    ids.add(id);
    const timer = setTimeout(() => {
      timers.delete(id);
      ids.delete(id);
      onExpire();
      emit();
    }, delayMs);
    timers.set(id, timer);
    emit();
  }

  return {
    schedule,
    cancel,
    isPending: (id) => ids.has(id),
    pendingIds: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface UndoBatchTracker<T> {
  /** Adds `item` to the current batch and (re)starts the shared expiry timer. */
  add(item: T): void;
  /** Current batch size. */
  count(): number;
  /** Current batch members, insertion order. */
  items(): readonly T[];
  /**
   * Cancels the shared timer and clears the batch, returning the items that
   * were pending (empty array if none) — the caller restores them.
   */
  restoreAll(): T[];
  subscribe(listener: () => void): Unsubscribe;
}

/**
 * A single shared-timer batch coalescer for the delete-undo pill: N deletes
 * within the window become one pill with a count, not N stacked pills.
 * `onExpire` fires once, with every batch member, when the window lapses
 * without an undo — by then the deletes are already committed, so this is
 * typically a no-op hook for callers that don't need it.
 */
export function createUndoBatchTracker<T>(
  onExpire: (items: T[]) => void,
  delayMs: number = DEFAULT_PENDING_DELAY_MS,
): UndoBatchTracker<T> {
  let batch: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  function emit(): void {
    listeners.forEach((listener) => listener());
  }

  function clearTimer(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  }

  function add(item: T): void {
    batch = [...batch, item];
    clearTimer();
    timer = setTimeout(() => {
      const expired = batch;
      batch = [];
      timer = undefined;
      onExpire(expired);
      emit();
    }, delayMs);
    emit();
  }

  function restoreAll(): T[] {
    const restored = batch;
    batch = [];
    clearTimer();
    if (restored.length > 0) emit();
    return restored;
  }

  return {
    add,
    count: () => batch.length,
    items: () => batch,
    restoreAll,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The inverse of `patch` against `row`: the row's current value for every key
 * the patch is about to change. Applying the result after the patch puts the
 * row back the way it was — the restore half of every single-tap undo pill
 * (Buy again, re-add suggestions, snooze, reset bought).
 */
export function revertPatch<Row extends object>(row: Row, patch: Partial<Row>): Partial<Row> {
  const revert: Partial<Row> = {};
  for (const key of Object.keys(patch) as (keyof Row)[]) revert[key] = row[key];
  return revert;
}
