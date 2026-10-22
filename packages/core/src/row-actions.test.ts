import { describe, expect, it } from 'vitest';
import { arrangeRowActions, hasRowActions, type RowAction } from './row-actions';

const run = () => {};

describe('arrangeRowActions', () => {
  it('orders groups by the shared grammar and keeps a row order inside each', () => {
    const actions: RowAction[] = [
      { id: 'delete', label: 'Delete', group: 'danger', run },
      { id: 'assign', label: 'Assign', group: 'set', options: [{ id: 'a', label: 'Ava', run }] },
      { id: 'due', label: 'Due', group: 'set', options: [{ id: 't', label: 'Today', run }] },
      { id: 'open', label: 'Open', group: 'open', run },
      { id: 'done', label: 'Done', group: 'state', run },
    ];
    expect(arrangeRowActions(actions).map((g) => g.map((a) => a.id))).toEqual([['open'], ['done'], ['assign', 'due'], ['delete']]);
  });

  it('drops empty entries, actions with nothing to do, and empty submenus', () => {
    const actions: (RowAction | null | false)[] = [
      null,
      false,
      { id: 'x', label: 'Nothing', group: 'edit' },
      { id: 'y', label: 'No options', group: 'set', options: [] },
      { id: 'edit', label: 'Edit details', group: 'edit', run },
    ];
    expect(arrangeRowActions(actions).map((g) => g.map((a) => a.id))).toEqual([['edit']]);
  });
});

describe('hasRowActions', () => {
  it('is false for a menu with nothing to show', () => {
    expect(hasRowActions([null, { id: 'x', label: 'x', group: 'open' }])).toBe(false);
    expect(hasRowActions([{ id: 'x', label: 'x', group: 'open', run }])).toBe(true);
  });
});
