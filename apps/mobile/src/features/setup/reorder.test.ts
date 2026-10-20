import { describe, expect, it } from 'vitest';
import { reindexRoomOrder } from './reorder';

describe('reindexRoomOrder', () => {
  it('assigns contiguous 0..n sort_order in the given id order', () => {
    expect(reindexRoomOrder(['c', 'a', 'b'])).toEqual([
      { id: 'c', sort_order: 0 },
      { id: 'a', sort_order: 1 },
      { id: 'b', sort_order: 2 },
    ]);
  });

  it('is a pure reindex — the same ids in a new order always produce 0..n regardless of prior sort_order values', () => {
    const moved = reindexRoomOrder(['b', 'c', 'a']);
    expect(moved.map((p) => p.sort_order)).toEqual([0, 1, 2]);
    expect(moved.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('handles a single item', () => {
    expect(reindexRoomOrder(['only'])).toEqual([{ id: 'only', sort_order: 0 }]);
  });

  it('handles an empty room', () => {
    expect(reindexRoomOrder([])).toEqual([]);
  });
});
