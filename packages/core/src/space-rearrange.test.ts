import { describe, expect, it } from 'vitest';
import {
  moveItem,
  reorderVisibleSections,
  SPACE_GRID_CELL_HEIGHT,
  spaceGridCellOrigin,
  spaceGridRows,
  spaceGridSlotAt,
} from './space-rearrange';

describe('moveItem', () => {
  it('moves forward and back, closing the gap', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('is a copy when nothing moves', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(moveItem(list, 1, 1)).not.toBe(list);
  });
});

describe('spaceGrid', () => {
  it('lays cells out four across', () => {
    expect(spaceGridCellOrigin(0, 80)).toEqual({ x: 0, y: 0 });
    expect(spaceGridCellOrigin(5, 80)).toEqual({ x: 80, y: SPACE_GRID_CELL_HEIGHT });
    expect(spaceGridRows(9)).toBe(3);
  });
  it('finds the cell under a point, clamped to the grid', () => {
    expect(spaceGridSlotAt(170, 30, 80, 10)).toBe(2);
    expect(spaceGridSlotAt(10, SPACE_GRID_CELL_HEIGHT + 5, 80, 10)).toBe(4);
    expect(spaceGridSlotAt(-50, -50, 80, 10)).toBe(0);
    expect(spaceGridSlotAt(900, 900, 80, 10)).toBe(9);
    expect(spaceGridSlotAt(300, SPACE_GRID_CELL_HEIGHT * 2 + 5, 80, 10)).toBe(9);
  });
});

describe('reorderVisibleSections', () => {
  it('keeps hidden sections in their places', () => {
    const order = ['home', 'tasks', 'secret', 'costs', 'recipes'];
    const visible = ['home', 'tasks', 'costs', 'recipes'];
    expect(reorderVisibleSections(order, visible, ['recipes', 'home', 'tasks', 'costs'])).toEqual([
      'recipes',
      'home',
      'secret',
      'tasks',
      'costs',
    ]);
  });
  it('returns the same order when nothing moved', () => {
    const order = ['a', 'b'];
    expect(reorderVisibleSections(order, ['a', 'b'], ['a', 'b'])).toBe(order);
  });
  it('appends a visible id the saved order never listed', () => {
    expect(reorderVisibleSections(['a', 'b'], ['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });
});
