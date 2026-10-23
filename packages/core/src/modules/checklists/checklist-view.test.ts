import { describe, expect, it } from 'vitest';
import {
  availableSortModes,
  partitionDone,
  resolveSortMode,
  sortItems,
} from './checklist-view';
import type { ChecklistTaskItem } from '../../types';

function item(overrides: Partial<ChecklistTaskItem>): ChecklistTaskItem {
  return {
    id: 'id',
    checklist_id: 'list-1',
    group_id: 'group-1',
    label: 'label',
    is_done: false,
    checked_by: null,
    checked_at: null,
    cost_cents: null,
    linked_cost_item_id: null,
    order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

describe('availableSortModes', () => {
  it('offers price only for shopping lists', () => {
    expect(availableSortModes('shopping')).toEqual(['manual', 'alpha', 'price', 'recent']);
    expect(availableSortModes('plain')).toEqual(['manual', 'alpha', 'recent']);
    expect(availableSortModes('repeating')).toEqual(['manual', 'alpha', 'recent']);
  });
});

describe('resolveSortMode', () => {
  it('passes through a stored mode this type offers', () => {
    expect(resolveSortMode('alpha', 'plain')).toBe('alpha');
    expect(resolveSortMode('price', 'shopping')).toBe('price');
  });

  it('falls back to manual when the type does not offer the stored mode', () => {
    expect(resolveSortMode('price', 'plain')).toBe('manual');
    expect(resolveSortMode('price', 'repeating')).toBe('manual');
  });

  it('falls back to manual for null/undefined/unrecognised values', () => {
    expect(resolveSortMode(null, 'shopping')).toBe('manual');
    expect(resolveSortMode(undefined, 'shopping')).toBe('manual');
    expect(resolveSortMode('bogus', 'shopping')).toBe('manual');
  });
});

describe('sortItems', () => {
  const a = item({ id: 'a', label: 'Banana', order: 2, cost_cents: 100, checked_at: '2026-01-02T00:00:00.000Z', is_done: true });
  const b = item({ id: 'b', label: 'apple', order: 0, cost_cents: 500, checked_at: '2026-01-03T00:00:00.000Z', is_done: true });
  const c = item({ id: 'c', label: 'Cherry', order: 1, cost_cents: null, checked_at: null, is_done: false });

  it('manual sorts by order ascending', () => {
    expect(sortItems([a, b, c], 'manual').map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('alpha sorts case-insensitively, tie-breaking on order', () => {
    expect(sortItems([a, b, c], 'alpha').map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('price sorts descending with nulls last, tie-breaking on order', () => {
    expect(sortItems([a, b, c], 'price').map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('recent sorts by checked_at descending with unchecked last, tie-breaking on order', () => {
    expect(sortItems([a, b, c], 'recent').map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('never mutates the input array', () => {
    const input = [a, b, c];
    const copy = [...input];
    sortItems(input, 'alpha');
    expect(input).toEqual(copy);
  });

  it('breaks ties on order when sort keys are equal', () => {
    const x = item({ id: 'x', label: 'same', order: 5 });
    const y = item({ id: 'y', label: 'same', order: 1 });
    expect(sortItems([x, y], 'alpha').map((i) => i.id)).toEqual(['y', 'x']);
  });
});

describe('partitionDone', () => {
  it('splits open/done while preserving input order in each half', () => {
    const open1 = item({ id: 'o1', is_done: false, order: 0 });
    const done1 = item({ id: 'd1', is_done: true, order: 1 });
    const open2 = item({ id: 'o2', is_done: false, order: 2 });
    const done2 = item({ id: 'd2', is_done: true, order: 3 });

    const { open, done } = partitionDone([open1, done1, open2, done2]);
    expect(open.map((i) => i.id)).toEqual(['o1', 'o2']);
    expect(done.map((i) => i.id)).toEqual(['d1', 'd2']);
  });

  it('puts the newest-checked done row first, whatever the input order', () => {
    const early = item({ id: 'early', is_done: true, order: 0, checked_at: '2026-10-19T08:00:00.000Z' });
    const unstamped = item({ id: 'unstamped', is_done: true, order: 1 });
    const late = item({ id: 'late', is_done: true, order: 2, checked_at: '2026-10-19T09:30:00.000Z' });
    const open1 = item({ id: 'o1', is_done: false, order: 3 });

    const { open, done } = partitionDone([early, unstamped, late, open1]);
    expect(open.map((i) => i.id)).toEqual(['o1']);
    expect(done.map((i) => i.id)).toEqual(['late', 'early', 'unstamped']);
  });

  it('returns empty arrays for an all-open or all-done projection', () => {
    const o = item({ id: 'o', is_done: false });
    const d = item({ id: 'd', is_done: true });
    expect(partitionDone([o])).toEqual({ open: [o], done: [] });
    expect(partitionDone([d])).toEqual({ open: [], done: [d] });
    expect(partitionDone([])).toEqual({ open: [], done: [] });
  });
});
