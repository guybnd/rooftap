// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { configureStoreEnvironment, type StoreEnvironment } from '../../data/store-environment';
import type { SetupItem, SetupStore } from '../../types';
import { useSeedSetupTemplates, useSetupFilters, useSetupListModes, useSetupNotice, useSetupRowPortals, useSetupStores } from './use-setup-list';

const seedTemplateItems = vi.hoisted(() => vi.fn());
vi.mock('./setup-templates', () => ({ seedTemplateItems }));

function makeMemoryEnv(memory = new Map<string, string>()): StoreEnvironment {
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

/** A Supabase stub whose every query chain resolves to `data` for its table. */
function fakeClient(byTable: Record<string, unknown[]>, calls: string[] = []): () => SupabaseClient {
  const client = {
    from(table: string) {
      calls.push(table);
      const result = Promise.resolve({ data: byTable[table] ?? [] });
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => result.then(resolve, reject);
      return chain;
    },
  };
  return () => client as unknown as SupabaseClient;
}

describe('useSetupFilters', () => {
  let memory: Map<string, string>;
  beforeEach(() => {
    memory = new Map();
    configureStoreEnvironment(makeMemoryEnv(memory));
  });

  it('remembers the status segment on the device', () => {
    const { result } = renderHook(() => useSetupFilters());
    expect(result.current.statusSegment).toBe('all');
    act(() => result.current.setStatusSegment('installed'));
    expect(result.current.statusFilters).toEqual(['installed']);
    expect(memory.get('setup_status_filters')).toBe('["installed"]');

    const again = renderHook(() => useSetupFilters());
    expect(again.result.current.statusSegment).toBe('installed');
  });

  it('restores after mount when asked, and ignores malformed values', () => {
    memory.set('setup_status_filters', '["needed"]');
    const { result } = renderHook(() => useSetupFilters({ restoreAfterMount: true }));
    expect(result.current.statusSegment).toBe('needed');

    memory.set('setup_status_filters', '{bad');
    expect(renderHook(() => useSetupFilters()).result.current.statusFilters).toEqual([]);
  });

  it('toggles mine only', () => {
    const { result } = renderHook(() => useSetupFilters());
    act(() => result.current.toggleMineOnly());
    expect(result.current.mineOnly).toBe(true);
  });
});

describe('useSetupListModes', () => {
  it('selects, clears, and leaves select mode for reorder', () => {
    const { result } = renderHook(() => useSetupListModes());
    act(() => result.current.toggleSelectMode());
    act(() => result.current.toggleSelect('a'));
    expect(result.current.selectedIds.has('a')).toBe(true);

    // The bar's X clears the selection first, then leaves select mode.
    act(() => result.current.clearOrExitSelect());
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.selectMode).toBe(true);
    act(() => result.current.clearOrExitSelect());
    expect(result.current.selectMode).toBe(false);

    act(() => result.current.toggleSelectMode());
    act(() => result.current.toggleSelect('b'));
    act(() => result.current.startReorder());
    expect(result.current.selectMode).toBe(false);
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.reorderMode).toBe(true);
    act(() => result.current.exitReorder());
    expect(result.current.reorderMode).toBe(false);
  });

  it('collapses and expands rooms', () => {
    const { result } = renderHook(() => useSetupListModes());
    act(() => result.current.toggleRoomCollapsed('Kitchen'));
    expect(result.current.collapsedRooms.has('Kitchen')).toBe(true);
    act(() => result.current.toggleRoomCollapsed('Kitchen'));
    expect(result.current.collapsedRooms.has('Kitchen')).toBe(false);
  });
});

describe('useSetupNotice', () => {
  afterEach(() => vi.useRealTimers());

  it('clears itself after five seconds', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSetupNotice());
    act(() => result.current[1]('Hello'));
    expect(result.current[0]).toBe('Hello');
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current[0]).toBeNull();
  });
});

describe('useSetupStores', () => {
  it('loads the group stores and adds new ones', async () => {
    const getClient = fakeClient({ setup_stores: [{ id: 's1', name: 'Ikea' }] });
    const { result } = renderHook(() => useSetupStores('g1', getClient));
    await waitFor(() => expect(result.current.stores).toHaveLength(1));
    act(() => result.current.addStore({ id: 's2', name: 'Bunnings' } as SetupStore));
    expect(result.current.stores.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('does nothing without a group', () => {
    const calls: string[] = [];
    renderHook(() => useSetupStores(null, fakeClient({}, calls)));
    expect(calls).toEqual([]);
  });
});

describe('useSetupRowPortals', () => {
  const items = [{ id: 'a' }, { id: 'b' }] as SetupItem[];
  const tables = {
    setup_item_comments: [{ setup_item_id: 'a', content: 'hi', user_id: 'u1', created_at: '2026-10-01' }],
    document_links: [{ entity_id: 'b', documents: { storage_path: 'p', source: 'other' } }],
  };

  it('waits for the store and for items, then fetches comments once', async () => {
    const calls: string[] = [];
    const getClient = fakeClient(tables, calls);
    const { result, rerender } = renderHook((p: { loaded: boolean; items: SetupItem[] }) =>
      useSetupRowPortals({ groupId: 'g1', getClient, loaded: p.loaded, items: p.items, docsOn: false }),
    { initialProps: { loaded: false, items: [] as SetupItem[] } });
    expect(calls).toEqual([]);
    rerender({ loaded: true, items: [] });
    expect(calls).toEqual([]);
    rerender({ loaded: true, items });
    await waitFor(() => expect(result.current.commentSummaries.a?.count).toBe(1));
    rerender({ loaded: true, items: [...items, { id: 'c' } as SetupItem] });
    expect(calls).toEqual(['setup_item_comments']);
    expect(result.current.docLinks).toEqual({});
  });

  it('fetches doc links once Documents is on', async () => {
    const getClient = fakeClient(tables);
    const { result, rerender } = renderHook((p: { docsOn: boolean }) =>
      useSetupRowPortals({ groupId: 'g1', getClient, loaded: true, items, docsOn: p.docsOn }),
    { initialProps: { docsOn: false } });
    rerender({ docsOn: true });
    await waitFor(() => expect(result.current.docLinks.b?.storagePath).toBe('p'));
  });
});

describe('useSeedSetupTemplates', () => {
  const getClient = fakeClient({});

  it('refreshes and reports how many were added', async () => {
    seedTemplateItems.mockResolvedValueOnce(3);
    const refresh = vi.fn();
    const onNotice = vi.fn();
    const { result } = renderHook(() => useSeedSetupTemplates({ groupId: 'g1', getClient, refresh, onNotice }));
    await act(() => result.current.seed());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledWith('Added 3 starter items.');
    expect(result.current.isSeeding).toBe(false);
  });

  it('skips the refresh when nothing was added, and reports failures', async () => {
    const refresh = vi.fn();
    const onNotice = vi.fn();
    const { result } = renderHook(() => useSeedSetupTemplates({ groupId: 'g1', getClient, refresh, onNotice }));
    seedTemplateItems.mockResolvedValueOnce(0);
    await act(() => result.current.seed());
    expect(refresh).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenLastCalledWith('Starter items are already in your list.');

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    seedTemplateItems.mockRejectedValueOnce(new Error('offline'));
    await act(() => result.current.seed());
    expect(onNotice).toHaveBeenLastCalledWith('Could not add starter items.');
    error.mockRestore();
  });
});
