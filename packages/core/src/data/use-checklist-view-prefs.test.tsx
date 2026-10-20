// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureStoreEnvironment, type StoreEnvironment } from './store-environment';
import { useChecklistViewPrefs } from './use-checklist-view-prefs';

function makeMemoryEnv(): StoreEnvironment {
  const memory = new Map<string, string>();
  return {
    supabase: {} as StoreEnvironment['supabase'],
    getPersistConfig: () => ({}),
    isOnline: () => true,
    isForeground: () => true,
    subscribeReconnect: () => () => {},
    subscribeForeground: () => () => {},
    keyValue: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
    },
    randomUUID: () => 'test-uuid',
  };
}

const defaults = { sortMode: 'manual', completedToBottom: true, collapsed: false };

describe('useChecklistViewPrefs', () => {
  beforeEach(() => {
    configureStoreEnvironment(makeMemoryEnv());
  });

  afterEach(() => {
    // Reset to an unconfigured state isn't exposed — a fresh memory env per
    // test (via beforeEach) is enough isolation since keys are checklist-scoped.
  });

  it('falls back to the given defaults when nothing is stored for this list', () => {
    const { result } = renderHook(() => useChecklistViewPrefs('list-1', 'plain', defaults));
    expect(result.current.sortMode).toBe('manual');
    expect(result.current.completedToBottom).toBe(true);
    expect(result.current.collapsed).toBe(false);
  });

  it('persists a per-list override and reflects it immediately', () => {
    const { result } = renderHook(() => useChecklistViewPrefs('list-1', 'shopping', defaults));

    act(() => result.current.setSortMode('price'));
    expect(result.current.sortMode).toBe('price');

    act(() => result.current.setCollapsed(true));
    expect(result.current.collapsed).toBe(true);
    // Untouched field keeps its default.
    expect(result.current.completedToBottom).toBe(true);
  });

  it('resolves a stored override this list type no longer offers back to manual', () => {
    const { result: shoppingResult } = renderHook(() => useChecklistViewPrefs('list-2', 'shopping', defaults));
    act(() => shoppingResult.current.setSortMode('price'));

    // Same device-local key, but a plain list can't offer 'price'.
    const { result: plainResult } = renderHook(() => useChecklistViewPrefs('list-2', 'plain', defaults));
    expect(plainResult.current.sortMode).toBe('manual');
  });

  it('keeps two lists independent', () => {
    const { result: a } = renderHook(() => useChecklistViewPrefs('list-a', 'plain', defaults));
    const { result: b } = renderHook(() => useChecklistViewPrefs('list-b', 'plain', defaults));

    act(() => a.current.setCollapsed(true));

    expect(a.current.collapsed).toBe(true);
    expect(b.current.collapsed).toBe(false);
  });

  it('falls back to defaults when no StoreEnvironment is configured (SSR / unconfigured test)', () => {
    // No configureStoreEnvironment call in this test's own scope would be
    // ideal, but the module-level `current` is shared process-wide; instead
    // assert the read/write helpers degrade via try/catch by pointing
    // keyValue at a throwing implementation.
    configureStoreEnvironment({
      ...makeMemoryEnv(),
      keyValue: {
        getItem: () => {
          throw new Error('window is not defined');
        },
        setItem: () => {
          throw new Error('window is not defined');
        },
      },
    });
    const { result } = renderHook(() => useChecklistViewPrefs('list-3', 'plain', defaults));
    expect(result.current.sortMode).toBe('manual');
    expect(result.current.completedToBottom).toBe(true);
  });
});
