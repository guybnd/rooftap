// @vitest-environment jsdom

// patchRow/softDeleteRow on an id the store doesn't hold used to assign() a
// partial row into it (only the patch's fields, no `name`), which the server
// rejects and the Recipes screen then crashed on. They now leave the store alone.

import { observable } from '@legendapp/state';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStoreHelpers } from './create-group-store';

type Row = { id: string; group_id: string; name: string; deleted: boolean; created_at: string | null; updated_at: string | null };

const row: Row = { id: 'a', group_id: 'g', name: 'Eggs', deleted: false, created_at: '2026-10-01', updated_at: '2026-10-01' };

describe('useStoreHelpers', () => {
  it('patchRow and softDeleteRow skip ids the store does not hold', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store$ = observable<Record<string, Row>>({ a: row });
    const { result } = renderHook(() => useStoreHelpers<Row>(store$, 'user-1'));
    result.current.patchRow('missing', { name: 'Milk' });
    result.current.softDeleteRow('gone');
    expect(Object.keys(store$.peek())).toEqual(['a']);
  });

  it('patchRow and softDeleteRow still update rows the store holds', () => {
    const store$ = observable<Record<string, Row>>({ a: row });
    const { result } = renderHook(() => useStoreHelpers<Row>(store$, 'user-1'));
    result.current.patchRow('a', { name: 'Free range eggs' });
    expect(store$.peek().a.name).toBe('Free range eggs');
    result.current.softDeleteRow('a');
    expect(store$.peek().a.deleted).toBe(true);
  });
});
