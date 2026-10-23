import { describe, expect, it } from 'vitest';
import type { SetupItem } from '../../types';
import {
  canSaveSetupItemForm,
  isNewSetupRoom,
  newSetupItemRow,
  quickAddSetupItem,
  setupCommentChipLabel,
  setupItemForm,
  setupItemFromForm,
  setupPriceDelta,
  setupPriceEdit,
  setupRoomOptions,
} from './setup-item-form';

const existing = newSetupItemRow('g1', { name: 'Lamp', room: 'Study', est_price: 40, url: 'https://x', notes: 'tall' }, 'i1', '2026-10-01T00:00:00.000Z');

describe('rooms', () => {
  it('offers the defaults first, then the household rooms, without duplicates', () => {
    const options = setupRoomOptions(['Kitchen', 'Study']);
    expect(options[0]).toBe('Kitchen');
    expect(options.at(-1)).toBe('Study');
    expect(options.filter((r) => r === 'Kitchen')).toHaveLength(1);
  });

  it('knows a room that is not on the list', () => {
    expect(isNewSetupRoom('Attic', setupRoomOptions([]))).toBe(true);
    expect(isNewSetupRoom('Garage', setupRoomOptions([]))).toBe(false);
    expect(isNewSetupRoom('', setupRoomOptions([]))).toBe(false);
  });
});

describe('setupItemForm', () => {
  it('starts blank in the default room', () => {
    expect(setupItemForm(undefined, 'Kitchen')).toEqual({
      name: '',
      room: 'Kitchen',
      priority: 'medium',
      status: 'needed',
      est_price: null,
      actual_price: null,
      store_id: null,
      url: '',
      notes: '',
    });
  });

  it('starts from the item', () => {
    expect(setupItemForm(existing, 'Kitchen')).toMatchObject({ name: 'Lamp', room: 'Study', est_price: 40, url: 'https://x', notes: 'tall' });
  });

  it('needs a name and a room', () => {
    expect(canSaveSetupItemForm({ name: ' ', room: 'Kitchen' })).toBe(false);
    expect(canSaveSetupItemForm({ name: 'Mop', room: ' ' })).toBe(false);
    expect(canSaveSetupItemForm({ name: 'Mop', room: 'Laundry' })).toBe(true);
  });
});

describe('setupItemFromForm', () => {
  it('builds a new row with trimmed text and null blanks', () => {
    const form = { ...setupItemForm(undefined), name: ' Mop ', room: ' Laundry ', url: ' ', notes: '' };
    const row = setupItemFromForm(form, undefined, 'g1');
    expect(row).toMatchObject({ group_id: 'g1', name: 'Mop', room: 'Laundry', url: null, notes: null, deleted: false, sort_order: 0 });
    expect(row.id).toBeTruthy();
  });

  it('keeps the item id and untouched columns on an edit', () => {
    const edited = { ...existing, assigned_to: 'u1' } as SetupItem;
    const row = setupItemFromForm({ ...setupItemForm(edited), name: 'Floor lamp' }, edited, 'g1');
    expect(row).toMatchObject({ id: 'i1', name: 'Floor lamp', assigned_to: 'u1', created_at: '2026-10-01T00:00:00.000Z' });
  });
});

describe('quickAddSetupItem', () => {
  it('adds a needed item to the room', () => {
    expect(quickAddSetupItem('g1', 'Kitchen', ' Kettle ')).toMatchObject({ name: 'Kettle', room: 'Kitchen', status: 'needed', priority: 'medium' });
  });

  it('leaves the room blank under Other, and skips a blank name', () => {
    expect(quickAddSetupItem('g1', 'Other', 'Hooks')?.room).toBe('');
    expect(quickAddSetupItem('g1', 'Kitchen', '  ')).toBeNull();
  });
});

describe('row helpers', () => {
  it('parses an inline price edit', () => {
    expect(setupPriceEdit(null, '25')).toBe(25);
    expect(setupPriceEdit(25, '')).toBeNull();
    expect(setupPriceEdit(25, '25')).toBeUndefined();
    expect(setupPriceEdit(null, ' ')).toBeUndefined();
    expect(setupPriceEdit(10, 'abc')).toBeUndefined();
  });

  it('works out the budget delta once both prices are known', () => {
    expect(setupPriceDelta({ est_price: 40, actual_price: 55 })).toBe(15);
    expect(setupPriceDelta({ est_price: 40, actual_price: null })).toBeNull();
  });

  it('names the comments chip', () => {
    expect(setupCommentChipLabel(0)).toBe('Comments');
    expect(setupCommentChipLabel(1)).toBe('1 comment');
    expect(setupCommentChipLabel(3)).toBe('3 comments');
  });
});
