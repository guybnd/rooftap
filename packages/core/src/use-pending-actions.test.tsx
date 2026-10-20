// @vitest-environment jsdom

// HOUP-245 review follow-up: pending-actions.test.ts only exercised the pure
// tracker, not the usePendingIds/useSyncExternalStore reactivity — which is
// exactly the seam that broke (pendingIds() returned the same mutated Set
// reference, so React's Object.is check never saw a change and the tick-off
// linger never auto-filtered). This drives the real hook through renderHook
// so a regression here fails a test instead of shipping silently.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPendingActionTracker } from './pending-actions';
import { usePendingIds } from './use-pending-actions';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePendingIds', () => {
  it('re-renders with the scheduled id, then re-renders again (without it) on expiry', () => {
    const tracker = createPendingActionTracker();
    const { result } = renderHook(() => usePendingIds(tracker));

    expect(result.current.has('a')).toBe(false);

    act(() => {
      tracker.schedule('a', () => {});
    });
    expect(result.current.has('a')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.has('a')).toBe(false);
  });

  it('reflects a cancel (re-tap within window) without waiting for expiry', () => {
    const tracker = createPendingActionTracker();
    const { result } = renderHook(() => usePendingIds(tracker));

    act(() => {
      tracker.schedule('a', () => {});
    });
    expect(result.current.has('a')).toBe(true);

    act(() => {
      tracker.cancel('a');
    });
    expect(result.current.has('a')).toBe(false);
  });
});
