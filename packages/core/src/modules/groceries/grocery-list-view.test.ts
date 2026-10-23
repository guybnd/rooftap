import { describe, expect, it, vi } from 'vitest';
import {
  createGroceryUndoActions,
  groceriesWithAisleMatches,
  groceryBuyableItems,
  groceryEstimate,
  groceryPriceCents,
  groceryTripTotals,
  type GroceryUndoPresenterFactory,
} from './grocery-list-view';
import type { GroceryItem } from '../../types';

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

const priceFor = (name: string) => (name === 'Bread' ? 400 : null);

describe('groceryPriceCents', () => {
  it("uses the item's own price, else the library price", () => {
    expect(groceryPriceCents(item({ price_cents: 250 }), priceFor)).toBe(250);
    expect(groceryPriceCents(item({ name: 'Bread' }), priceFor)).toBe(400);
    expect(groceryPriceCents(item(), priceFor)).toBeNull();
  });
});

describe('groceryBuyableItems', () => {
  it('drops Have it', () => {
    const list = [item({ id: 'a' }), item({ id: 'b', status: 'have' }), item({ id: 'c', status: 'bought' })];
    expect(groceryBuyableItems(list).map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('groceryEstimate', () => {
  it('sums one unit price per item and counts the unpriced', () => {
    const list = [item({ price_cents: 250, quantity: 3 }), item({ name: 'Bread' }), item({ name: 'Eggs' })];
    expect(groceryEstimate(list, priceFor)).toEqual({ cents: 650, unpriced: 1 });
    expect(groceryEstimate([], priceFor)).toEqual({ cents: 0, unpriced: 0 });
  });
});

describe('groceryTripTotals', () => {
  const today = '2026-10-23';
  const got = (over: Partial<GroceryItem>) => item({ status: 'bought', last_purchased_at: `${today}T01:00:00.000Z`, ...over });

  it('counts what was marked Got it today, at the price paid first', () => {
    const items = [
      got({ id: 'paid', last_price: 300, price_cents: 999 }),
      got({ id: 'lib', name: 'Bread' }),
      got({ id: 'none', name: 'Eggs' }),
      item({ id: 'old', status: 'bought', last_purchased_at: '2026-10-01T01:00:00.000Z', price_cents: 500 }),
      item({ id: 'needed', price_cents: 500 }),
    ];
    const trip = groceryTripTotals(items, priceFor, today);
    expect(trip.items.map((i) => i.id)).toEqual(['paid', 'lib', 'none']);
    expect(trip.cents).toBe(700);
    expect(trip.unpriced).toBe(1);
  });
});

describe('groceriesWithAisleMatches', () => {
  const items = [item({ id: 'milk' }), item({ id: 'cheese', name: 'Cheese' }), item({ id: 'bread', name: 'Bread', aisle: 'bakery' })];

  it('returns the matches alone when no aisle is named', () => {
    expect(groceriesWithAisleMatches([items[2]], items, [])).toEqual([items[2]]);
  });

  it('adds the named aisle after the matches, without repeats', () => {
    expect(groceriesWithAisleMatches([items[1], items[2]], items, ['dairy_eggs']).map((i) => i.id)).toEqual(['cheese', 'bread', 'milk']);
  });
});

describe('createGroceryUndoActions', () => {
  it('runs each kind through its own presenter with its label and patch', () => {
    const runs: { label: string; patch: Partial<GroceryItem> }[] = [];
    const factory: GroceryUndoPresenterFactory = ({ message }) => ({
      run(rows, patch) {
        const list = Array.isArray(rows) ? rows : [rows];
        runs.push({ label: message(list.length, list[list.length - 1]), patch });
      },
    });
    const apply = vi.fn();
    const actions = createGroceryUndoActions(factory, apply);
    const milk = item();

    actions.needAgain([milk, item({ id: 'gi2', name: 'Eggs' })]);
    actions.snooze(milk, '2026-11-01T00:00:00.000Z');
    actions.hide(milk);
    actions.resetBought([milk]);

    expect(runs.map((r) => r.label)).toEqual(['2 items added to list', expect.stringContaining('Milk'), expect.stringContaining('Milk'), expect.any(String)]);
    expect(runs[0].patch.status).toBe('needed');
    expect(runs[1].patch).toEqual({ re_add_snoozed_until: '2026-11-01T00:00:00.000Z' });
    expect(typeof runs[2].patch.re_add_dismissed_at).toBe('string');
    expect(runs[3].patch).toMatchObject({ status: 'needed', last_purchased_at: null });
  });
});
