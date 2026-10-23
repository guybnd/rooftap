// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useGrocerySearch } from './use-grocery-search';
import { useGroceryAux } from './use-grocery-aux';
import { useSuggestDismiss } from './use-suggest-dismiss';
import type { GroceryCustomAisle, GroceryItem } from '../../types';

function item(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'gi1',
    group_id: 'g1',
    name: 'Milk',
    aisle: 'dairy_eggs',
    quantity: null,
    unit: null,
    status: 'needed',
    notes: null,
    assigned_to: null,
    private: false,
    template_key: null,
    sort_order: 0,
    created_by: null,
    updated_by: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    deleted: false,
    recurrence_days: null,
    status_changed_at: null,
    last_purchased_at: null,
    last_price: null,
    lowest_price: null,
    expiry_date: null,
    shelf_life_days: null,
    price_cents: null,
    is_essential: false,
    recipe_note: null,
    recipe_source_id: null,
    re_add_snoozed_until: null,
    re_add_dismissed_at: null,
    ...overrides,
  } as GroceryItem;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useGrocerySearch', () => {
  const items = [item({ id: 'milk' }), item({ id: 'cheese', name: 'Cheese' }), item({ id: 'bread', name: 'Bread', aisle: 'bakery' })];

  it('passes everything through with no query', () => {
    const { result } = renderHook(() => useGrocerySearch(items, '', []));
    expect(result.current.searchedItems).toBe(items);
  });

  it('keeps the quantity apart and lists a named aisle', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ q }) => useGrocerySearch(items, q, []), { initialProps: { q: '' } });
    rerender({ q: '2 bread' });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current.searchEntry.name).toBe('bread');
    expect(result.current.searchedItems.map((i) => i.id)).toEqual(['bread']);

    rerender({ q: 'dairy' });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current.searchedItems.map((i) => i.id).sort()).toEqual(['cheese', 'milk']);
  });
});

/** A thenable query builder that resolves to `rows`, like supabase-js. */
function query(rows: unknown[]) {
  const q: Record<string, unknown> = {
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  for (const m of ['select', 'eq', 'order']) q[m] = () => q;
  return q;
}

/** A client whose grocery_aisles read returns `aisles` and whose item library read returns `library`. */
function fakeClient(aisles: Partial<GroceryCustomAisle>[], library: unknown[] = []) {
  return { from: (table: string) => query(table === 'grocery_aisles' ? aisles : library) } as unknown as SupabaseClient;
}

describe('useGroceryAux', () => {
  it('loads the aisles and keeps the same object across renders', async () => {
    const client = fakeClient([{ id: 'a1', name: 'Pets', sort_order: 0 }]);
    const getClient = () => client;
    const { result, rerender } = renderHook(() => useGroceryAux('g1', getClient));
    await waitFor(() => expect(result.current.customAisles.map((a) => a.name)).toEqual(['Pets']));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('fetches nothing without a group, and survives a client that throws', async () => {
    const getClient = vi.fn(() => {
      throw new Error('not bound');
    });
    const { result, rerender } = renderHook(({ g }) => useGroceryAux(g, getClient), { initialProps: { g: null as string | null } });
    expect(getClient).not.toHaveBeenCalled();
    rerender({ g: 'g1' });
    await waitFor(() => expect(getClient).toHaveBeenCalled());
    expect(result.current.customAisles).toEqual([]);
  });
});

describe('useSuggestDismiss', () => {
  it('runs a stored choice without asking or saving', () => {
    const hide = vi.fn();
    const archive = vi.fn();
    const getClient = vi.fn();
    const { result } = renderHook(() => useSuggestDismiss({ hide, archive, stored: 'archive', refresh: vi.fn(), getClient }));
    expect(result.current.dismissAction).toBe('archive');
    act(() => result.current.dismiss(item(), 'archive'));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(getClient).not.toHaveBeenCalled();
  });

  it('remembers the first pick at once and saves it', async () => {
    const hide = vi.fn();
    const upsert = vi.fn(() => Promise.resolve({ error: null }));
    const client = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      from: () => ({ upsert }),
    } as unknown as SupabaseClient;
    const refresh = vi.fn();
    const { result } = renderHook(() => useSuggestDismiss({ hide, archive: vi.fn(), stored: null, refresh, getClient: () => client }));
    expect(result.current.dismissAction).toBeNull();
    act(() => result.current.dismiss(item(), 'not_now'));
    expect(hide).toHaveBeenCalledTimes(1);
    expect(result.current.dismissAction).toBe('not_now');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', grocery_suggest_dismiss: 'not_now' }),
      { onConflict: 'user_id' }
    );
  });

  it('keeps the pick when the client is not bound yet', () => {
    const refresh = vi.fn();
    const { result } = renderHook(() =>
      useSuggestDismiss({
        hide: vi.fn(),
        archive: vi.fn(),
        stored: null,
        refresh,
        getClient: () => {
          throw new Error('not bound');
        },
      })
    );
    expect(() => act(() => result.current.dismiss(item(), 'not_now'))).not.toThrow();
    expect(result.current.dismissAction).toBe('not_now');
  });
});
