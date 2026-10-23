import { describe, expect, it } from 'vitest';
import { applyGroceryDisposition } from './grocery-items';
import type { GroceryItem } from '../../types';

function item(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'gi1',
    group_id: 'g1',
    name: 'Milk',
    aisle: 'Dairy',
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
    recipe_note: 'for Lasagna',
    recipe_source_id: 'recipe-1',
    re_add_snoozed_until: null,
    re_add_dismissed_at: null,
    ...overrides,
  };
}

describe('applyGroceryDisposition', () => {
  it('needed -> bought stamps last_purchased_at (today) and last_price from the item\'s own price_cents', () => {
    const now = new Date('2026-06-20T10:00:00.000Z');
    const patch = applyGroceryDisposition(item({ price_cents: 350 }), 'bought', { now });
    expect(patch).toMatchObject({
      status: 'bought',
      status_changed_at: now.toISOString(),
      last_purchased_at: '2026-06-20',
      last_price: 350,
    });
  });

  it('an explicit priceCents override wins over the item\'s own price_cents (in-app library-price fallback case)', () => {
    const patch = applyGroceryDisposition(item({ price_cents: 350 }), 'bought', { priceCents: 275 });
    expect(patch.last_price).toBe(275);
  });

  it('falls back to null last_price when neither the item nor an override has a price', () => {
    const patch = applyGroceryDisposition(item({ price_cents: null }), 'bought');
    expect(patch.last_price).toBeNull();
  });

  it('bought -> needed clears last_purchased_at and does not touch last_price', () => {
    const patch = applyGroceryDisposition(item({ status: 'bought', last_purchased_at: '2026-06-15', last_price: 400 }), 'needed');
    expect(patch.last_purchased_at).toBeNull();
    expect(patch.last_price).toBeUndefined();
  });

  it('clears the ephemeral recipe note when leaving needed, keeps it when staying needed is not applicable (target !== needed)', () => {
    const patch = applyGroceryDisposition(item(), 'have');
    expect(patch.recipe_note).toBeNull();
    expect(patch.recipe_source_id).toBeNull();
  });
});
