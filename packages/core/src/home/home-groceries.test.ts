import { describe, expect, it } from 'vitest';
import type { GroceryItem } from '../types';
import { HOME_GROCERY_EXPAND_THRESHOLD, findGroceryByName, groceryNeededAgainPatch, homeGroceryRows } from './home-groceries';

const TODAY = '2026-10-23';

function g(id: string, over: Partial<GroceryItem> = {}): GroceryItem {
  return { id, name: id, status: 'needed', is_essential: false, last_purchased_at: null, deleted: false, ...over } as GroceryItem;
}

describe('homeGroceryRows', () => {
  it('a short list shows every needed item and what was bought today, essentials first', () => {
    const items = [
      g('milk'),
      g('bread', { is_essential: true }),
      g('eggs', { status: 'bought', last_purchased_at: TODAY }),
      g('jam', { status: 'bought', last_purchased_at: '2026-10-20' }),
      g('salt', { status: 'have' }),
    ];
    const rows = homeGroceryRows(items, { expanded: false, today: TODAY });
    expect(rows.showFullList).toBe(true);
    expect(rows.cardItems.map((i) => i.id)).toEqual(['bread', 'milk', 'eggs']);
    expect(rows.overflowNames).toEqual([]);
  });

  it('a long list shows the essentials and sums up the rest', () => {
    const many = Array.from({ length: HOME_GROCERY_EXPAND_THRESHOLD }, (_, n) => g(`item${String(n).padStart(2, '0')}`));
    const items = [...many, g('bread', { is_essential: true }), g('eggs', { status: 'bought', last_purchased_at: TODAY })];
    const rows = homeGroceryRows(items, { expanded: false, today: TODAY });
    expect(rows.showFullList).toBe(false);
    expect(rows.cardItems.map((i) => i.id)).toEqual(['bread']);
    expect(rows.overflowNames).toEqual(many.map((i) => i.name));
    expect(rows.fullItems).toHaveLength(12);

    const expanded = homeGroceryRows(items, { expanded: true, today: TODAY });
    expect(expanded.cardItems).toHaveLength(12);
    expect(expanded.overflowNames).toEqual([]);
  });

  it('keeps a lingering row on the card, last', () => {
    const many = Array.from({ length: HOME_GROCERY_EXPAND_THRESHOLD }, (_, n) => g(`n${n}`));
    const items = [...many, g('salt', { status: 'have' })];
    const rows = homeGroceryRows(items, { expanded: false, today: TODAY, lingering: new Set(['salt']) });
    expect(rows.cardItems.map((i) => i.id)).toEqual(['salt']);
    expect(homeGroceryRows([g('a'), g('salt', { status: 'have' })], { expanded: false, today: TODAY, lingering: new Set(['salt']) }).cardItems.map((i) => i.id)).toEqual(['a', 'salt']);
  });
});

describe('quick add', () => {
  it('matches a name ignoring case, and tolerates a nameless row', () => {
    const items = [g('x', { name: undefined as unknown as string }), g('Milk')];
    expect(findGroceryByName(items, 'mILK')?.id).toBe('Milk');
    expect(findGroceryByName(items, 'tea')).toBeUndefined();
  });

  it('puts an item back to Needed', () => {
    expect(groceryNeededAgainPatch('2026-10-23T01:00:00.000Z')).toEqual({
      status: 'needed',
      last_purchased_at: null,
      status_changed_at: '2026-10-23T01:00:00.000Z',
    });
  });
});
