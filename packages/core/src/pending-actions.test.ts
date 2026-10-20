import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPendingActionTracker, createUndoBatchTracker, DEFAULT_PENDING_DELAY_MS, revertPatch } from './pending-actions';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createPendingActionTracker', () => {
  it('is not pending before schedule', () => {
    const tracker = createPendingActionTracker();
    expect(tracker.isPending('a')).toBe(false);
  });

  it('start: marks pending immediately and notifies listeners', () => {
    const tracker = createPendingActionTracker();
    const listener = vi.fn();
    tracker.subscribe(listener);
    tracker.schedule('a', vi.fn());
    expect(tracker.isPending('a')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('expire: fires onExpire and clears pending after the delay', () => {
    const tracker = createPendingActionTracker();
    const onExpire = vi.fn();
    tracker.schedule('a', onExpire, 4000);
    expect(tracker.isPending('a')).toBe(true);
    vi.advanceTimersByTime(3999);
    expect(tracker.isPending('a')).toBe(true);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(tracker.isPending('a')).toBe(false);
  });

  it('cancel: reverts cleanly without calling onExpire', () => {
    const tracker = createPendingActionTracker();
    const onExpire = vi.fn();
    tracker.schedule('a', onExpire);
    tracker.cancel('a');
    expect(tracker.isPending('a')).toBe(false);
    vi.advanceTimersByTime(DEFAULT_PENDING_DELAY_MS);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('cancel is a no-op for an id that was never scheduled', () => {
    const tracker = createPendingActionTracker();
    expect(() => tracker.cancel('missing')).not.toThrow();
  });

  it('re-scheduling the same id restarts only that id\'s own timer', () => {
    const tracker = createPendingActionTracker();
    const onExpire = vi.fn();
    tracker.schedule('a', onExpire, 4000);
    vi.advanceTimersByTime(3000);
    tracker.schedule('a', onExpire, 4000); // re-tap within window
    vi.advanceTimersByTime(3000);
    expect(onExpire).not.toHaveBeenCalled(); // would have fired at t=4000 without the restart
    vi.advanceTimersByTime(1000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce across items: item A expiring does not touch item B\'s timer', () => {
    const tracker = createPendingActionTracker();
    const onExpireA = vi.fn();
    const onExpireB = vi.fn();
    tracker.schedule('a', onExpireA, 1000);
    tracker.schedule('b', onExpireB, 4000);
    vi.advanceTimersByTime(1000);
    expect(onExpireA).toHaveBeenCalledTimes(1);
    expect(onExpireB).not.toHaveBeenCalled();
    expect(tracker.isPending('b')).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(onExpireB).toHaveBeenCalledTimes(1);
  });

  it('pendingIds reflects the live set', () => {
    const tracker = createPendingActionTracker();
    tracker.schedule('a', vi.fn());
    tracker.schedule('b', vi.fn());
    expect([...tracker.pendingIds()].sort()).toEqual(['a', 'b']);
    tracker.cancel('a');
    expect([...tracker.pendingIds()]).toEqual(['b']);
  });

  it('unsubscribe stops further notifications', () => {
    const tracker = createPendingActionTracker();
    const listener = vi.fn();
    const unsubscribe = tracker.subscribe(listener);
    unsubscribe();
    tracker.schedule('a', vi.fn());
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createUndoBatchTracker', () => {
  it('start: adding an item makes it the sole batch member', () => {
    const tracker = createUndoBatchTracker<string>(vi.fn());
    tracker.add('item-1');
    expect(tracker.count()).toBe(1);
    expect(tracker.items()).toEqual(['item-1']);
  });

  it('coalesce: a second delete within the window joins the same batch instead of stacking', () => {
    const tracker = createUndoBatchTracker<string>(vi.fn());
    tracker.add('item-1');
    vi.advanceTimersByTime(2000);
    tracker.add('item-2');
    expect(tracker.count()).toBe(2);
    expect(tracker.items()).toEqual(['item-1', 'item-2']);
  });

  it('coalesce: a later add restarts the shared timer for the WHOLE batch', () => {
    const onExpire = vi.fn();
    const tracker = createUndoBatchTracker<string>(onExpire, 4000);
    tracker.add('item-1');
    vi.advanceTimersByTime(3000);
    tracker.add('item-2'); // restarts the shared 4000ms window
    vi.advanceTimersByTime(3000);
    expect(onExpire).not.toHaveBeenCalled(); // would have fired at t=4000 without the restart
    vi.advanceTimersByTime(1000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith(['item-1', 'item-2']);
  });

  it('expire: fires onExpire once with every batch member and clears the batch', () => {
    const onExpire = vi.fn();
    const tracker = createUndoBatchTracker<string>(onExpire, 4000);
    tracker.add('item-1');
    tracker.add('item-2');
    vi.advanceTimersByTime(4000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith(['item-1', 'item-2']);
    expect(tracker.count()).toBe(0);
  });

  it('cancel (restoreAll): returns every pending item and clears the batch without calling onExpire', () => {
    const onExpire = vi.fn();
    const tracker = createUndoBatchTracker<string>(onExpire, 4000);
    tracker.add('item-1');
    tracker.add('item-2');
    const restored = tracker.restoreAll();
    expect(restored).toEqual(['item-1', 'item-2']);
    expect(tracker.count()).toBe(0);
    vi.advanceTimersByTime(4000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('restoreAll on an empty batch returns an empty array and does not throw', () => {
    const tracker = createUndoBatchTracker<string>(vi.fn());
    expect(tracker.restoreAll()).toEqual([]);
  });

  it('notifies subscribers on add and on restoreAll', () => {
    const tracker = createUndoBatchTracker<string>(vi.fn());
    const listener = vi.fn();
    tracker.subscribe(listener);
    tracker.add('item-1');
    expect(listener).toHaveBeenCalledTimes(1);
    tracker.restoreAll();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('revertPatch', () => {
  it('captures the current value of every patched key, and only those', () => {
    const row = { id: 'a', status: 'have', status_changed_at: '2026-10-01T00:00:00Z', name: 'Milk', snoozed: null as string | null };
    const patch = { status: 'needed', status_changed_at: '2026-10-18T00:00:00Z', snoozed: '2026-10-20' };
    expect(revertPatch(row, patch)).toEqual({ status: 'have', status_changed_at: '2026-10-01T00:00:00Z', snoozed: null });
  });

  it('round-trips: applying the patch then the revert restores the row', () => {
    const row = { id: 'a', done: false, completed_at: null as string | null };
    const patch = { done: true, completed_at: '2026-10-18T00:00:00Z' };
    const revert = revertPatch(row, patch);
    expect({ ...row, ...patch, ...revert }).toEqual(row);
  });
});
