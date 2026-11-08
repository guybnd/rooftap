// @vitest-environment jsdom
import { observable } from '@legendapp/state';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readableRows, stableRows, useRows } from './use-rows';

interface Row {
  id: string;
  group_id: string;
  deleted: boolean;
  name?: string | null;
  tags?: string[];
}

const row = (id: string, extra: Partial<Row> = {}): Row => ({ id, group_id: 'g', deleted: false, name: id, ...extra });

describe('readableRows', () => {
  it('skips tombstones, partial rows, deleted rows and rows missing a required field', () => {
    const record = {
      a: row('a'),
      b: Symbol('delete') as unknown as Row,
      c: { group_id: 'g', deleted: false } as unknown as Row,
      d: row('d', { deleted: true }),
      e: row('e', { name: null }),
      f: undefined,
    };
    expect(readableRows(record).map((r) => r.id)).toEqual(['a', 'e']);
    expect(readableRows(record, ['name']).map((r) => r.id)).toEqual(['a']);
    expect(readableRows(record, [], true).map((r) => r.id)).toEqual(['a', 'd', 'e']);
    expect(readableRows(null)).toEqual([]);
  });
});

describe('stableRows', () => {
  it('keeps the old array when nothing changed, and old objects for unchanged rows', () => {
    const prev = [row('a'), row('b', { tags: ['x'] })];
    const same = stableRows(prev, [row('a'), row('b', { tags: ['x'] })]);
    expect(same).toBe(prev);

    const changed = stableRows(prev, [row('a'), row('b', { tags: ['y'] })]);
    expect(changed).not.toBe(prev);
    expect(changed[0]).toBe(prev[0]);
    expect(changed[1]).not.toBe(prev[1]);

    const reordered = stableRows(prev, [row('b', { tags: ['x'] }), row('a')]);
    expect(reordered).not.toBe(prev);
    expect(reordered[0]).toBe(prev[1]);
  });
});

describe('useRows', () => {
  it('returns the same array across renders until a row changes, and sees in-place edits', () => {
    const store$ = observable<Record<string, Row>>({ a: row('a', { tags: ['x'] }), b: row('b') });
    const { result, rerender } = renderHook(() => useRows(store$));
    const first = result.current;
    expect(first.map((r) => r.id)).toEqual(['a', 'b']);

    rerender();
    expect(result.current).toBe(first);

    // A nested edit Legend makes in place on the same array (#644's case).
    act(() => {
      store$.a.tags[0].set('y');
    });
    expect(result.current).not.toBe(first);
    expect(result.current[0].tags).toEqual(['y']);
    expect(result.current[1]).toBe(first[1]);

    act(() => {
      store$.b.deleted.set(true);
    });
    expect(result.current.map((r) => r.id)).toEqual(['a']);
  });

  it('applies the where filter', () => {
    const store$ = observable<Record<string, Row>>({ a: row('a'), b: row('b') });
    const { result } = renderHook(() => useRows(store$, (r) => r.id === 'b'));
    expect(result.current.map((r) => r.id)).toEqual(['b']);
  });
});
