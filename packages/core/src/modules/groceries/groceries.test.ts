import { describe, expect, it } from 'vitest';
import { GROCERY_UNDO_LABELS, parseGroceryShow, formatEntryQuantity, groceryAislesMatching, grocerySearchAddOptions, isReAddDismissed, parseGroceryEntry, recentGroceryPicks, sortGroceriesFlat, suggestReAdd, unitQtyMax, unitQtyStep } from './groceries';
import type { LibraryOverride } from './item-library';
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

describe('sortGroceriesFlat', () => {
  it('orders by status tier: needed -> bought -> have, regardless of essential', () => {
    const items = [
      item({ id: 'have', name: 'Z', status: 'have', is_essential: true }),
      item({ id: 'bought', name: 'A', status: 'bought' }),
      item({ id: 'needed', name: 'M', status: 'needed' }),
    ];
    const sorted = sortGroceriesFlat(items);
    expect(sorted.map((i) => i.id)).toEqual(['needed', 'bought', 'have']);
  });

  it('ranks essentials ahead of non-essentials within the same status tier', () => {
    const items = [
      item({ id: 'plain', name: 'Bananas', status: 'needed', is_essential: false }),
      item({ id: 'essential', name: 'Zucchini', status: 'needed', is_essential: true }),
    ];
    const sorted = sortGroceriesFlat(items);
    expect(sorted.map((i) => i.id)).toEqual(['essential', 'plain']);
  });

  it('breaks ties by name, case-insensitive and numeric-aware', () => {
    const items = [
      item({ id: 'item10', name: 'Item 10' }),
      item({ id: 'apple-lower', name: 'apple' }),
      item({ id: 'item2', name: 'Item 2' }),
      item({ id: 'Apple-upper', name: 'Apple' }),
    ];
    const sorted = sortGroceriesFlat(items);
    // Case-insensitive: the two "apple" rows sort adjacent (input order between
    // ties, stable sort). Numeric-aware: "Item 2" before "Item 10", not lexical.
    expect(sorted.map((i) => i.id)).toEqual(['apple-lower', 'Apple-upper', 'item2', 'item10']);
  });

  it('sorts a row with a missing name without throwing (null-guarded per sort.ts)', () => {
    const items = [
      item({ id: 'named', name: 'Bread' }),
      { ...item({ id: 'unnamed' }), name: undefined } as unknown as GroceryItem,
    ];
    expect(() => sortGroceriesFlat(items)).not.toThrow();
    const sorted = sortGroceriesFlat(items);
    expect(sorted).toHaveLength(2);
  });

  it('sorts rows with a missing status or is_essential without throwing', () => {
    const items = [
      item({ id: 'named', name: 'Bread' }),
      { ...item({ id: 'no-status' }), status: undefined } as unknown as GroceryItem,
      { ...item({ id: 'no-essential' }), is_essential: undefined } as unknown as GroceryItem,
    ];
    expect(() => sortGroceriesFlat(items)).not.toThrow();
    const sorted = sortGroceriesFlat(items);
    expect(sorted).toHaveLength(3);
  });

  it('does not mutate the input array', () => {
    const items = [item({ id: 'b', name: 'B' }), item({ id: 'a', name: 'A' })];
    const original = [...items];
    sortGroceriesFlat(items);
    expect(items).toEqual(original);
  });

  it('handles empty and single-item inputs', () => {
    expect(sortGroceriesFlat([])).toEqual([]);
    const single = [item({ id: 'only' })];
    expect(sortGroceriesFlat(single)).toEqual(single);
  });
});

describe('suggestReAdd with rows that are still syncing or malformed', () => {
  const today = '2026-06-20';
  const stale = (overrides: Record<string, unknown> = {}) =>
    item({ status: 'have', status_changed_at: '2026-06-01T09:00:00.000Z', shelf_life_days: 7, ...overrides } as Partial<GroceryItem>);

  it('skips bad rows and still suggests the good ones', () => {
    const rows = [
      stale({ id: 'num-date', status_changed_at: 1717232400000 }),
      stale({ id: 'obj-date', status_changed_at: {} }),
      stale({ id: 'no-name', name: undefined, shelf_life_days: null }),
      stale({ id: 'num-name', name: 42, shelf_life_days: null }),
      stale({ id: 'bad-snooze', re_add_snoozed_until: 20260701 }),
      stale({ id: 'bad-days', shelf_life_days: '7' }),
      stale({ id: 'bad-dismiss', re_add_dismissed_at: 5 }),
      undefined as unknown as GroceryItem,
      stale({ id: 'good' }),
    ];
    const ids = suggestReAdd(rows, new Map(), today).map((i) => i.id);
    expect(ids).toContain('good');
    expect(ids).not.toContain('num-date');
    expect(ids).not.toContain('obj-date');
    expect(ids).not.toContain('no-name');
    expect(ids).not.toContain('num-name');
  });

  it('never throws, whatever a row holds', () => {
    const weird = [{}, { status: 'have' }, { status: 'have', status_changed_at: '' }, { status: 'have', status_changed_at: 'x', name: [] }];
    expect(() => suggestReAdd(weird as unknown as GroceryItem[], new Map(), today)).not.toThrow();
  });
});

describe('suggestReAdd dismissal', () => {
  const today = '2026-06-20';
  // Marked have-it on Jun 1 with a 7-day shelf life: 12 days overdue by today.
  const stale = (overrides: Partial<GroceryItem> = {}) =>
    item({ status: 'have', status_changed_at: '2026-06-01T09:00:00.000Z', shelf_life_days: 7, ...overrides });

  it('suggests an overdue have-it item that was never dismissed', () => {
    expect(suggestReAdd([stale()], undefined, today).map((i) => i.id)).toEqual(['gi1']);
  });

  it('hides an item dismissed after it was marked have-it', () => {
    const dismissed = stale({ re_add_dismissed_at: '2026-06-15T18:00:00.000Z' });
    expect(suggestReAdd([dismissed], undefined, today)).toEqual([]);
  });

  it('suggests it again once the item has been bought since the dismissal', () => {
    // Dismissed Jun 15, then bought and marked have-it again Jun 16 (+7d = overdue by Jun 24).
    const rebought = stale({
      re_add_dismissed_at: '2026-06-15T18:00:00.000Z',
      status_changed_at: '2026-06-16T10:00:00.000Z',
    });
    expect(suggestReAdd([rebought], undefined, '2026-06-30').map((i) => i.id)).toEqual(['gi1']);
  });

  it('compares instants, not strings (server +00:00 vs client Z)', () => {
    expect(
      isReAddDismissed({
        status_changed_at: '2026-06-01T09:00:00+00:00',
        re_add_dismissed_at: '2026-06-01T09:00:00.500Z',
      }),
    ).toBe(true);
    expect(isReAddDismissed({ status_changed_at: '2026-06-01T09:00:00Z', re_add_dismissed_at: null })).toBe(false);
  });
});

describe('grocerySearchAddOptions', () => {
  const lib = (item_name: string, extra: Partial<LibraryOverride> = {}): LibraryOverride => ({
    item_name,
    shelf_life_days: null,
    typical_price_cents: null,
    aisle: null,
    ...extra,
  });

  it('offers nothing for an empty query', () => {
    expect(grocerySearchAddOptions([], [lib('Milk')], '   ')).toEqual({
      addName: null,
      addAisle: 'other',
      librarySuggestions: [],
      quantity: null,
      unit: null,
    });
  });

  it('offers the query as a new item even when a partial match is on the list', () => {
    const r = grocerySearchAddOptions([item({ name: 'Oat milk' })], [], ' milk ');
    expect(r.addName).toBe('milk');
    expect(r.addAisle).toBe('dairy_eggs');
  });

  it('does not offer a name the list already has, plural-insensitively', () => {
    expect(grocerySearchAddOptions([item({ name: 'Eggs' })], [], 'egg').addName).toBeNull();
  });

  it('suggests library entries not on the list, exact match first, and skips tombstones', () => {
    const r = grocerySearchAddOptions(
      [item({ name: 'Greek yogurt' })],
      [lib('Yogurt tubes'), lib('Greek yogurt'), lib('Yogurt', { aisle: 'dairy_eggs' }), lib('Yogurt bites', { hidden: true })],
      'yogurt'
    );
    expect(r.librarySuggestions.map((o) => o.item_name)).toEqual(['Yogurt', 'Yogurt tubes']);
    // The exact library entry is the add, so the plain fallback is dropped.
    expect(r.addName).toBeNull();
  });

  it("guesses the aisle from the library before the built-in catalog, else 'other'", () => {
    expect(grocerySearchAddOptions([], [lib('Bananas', { aisle: 'pantry' })], 'banana').addAisle).toBe('pantry');
    expect(grocerySearchAddOptions([], [], 'banana').addAisle).toBe('produce');
    expect(grocerySearchAddOptions([], [], 'zzqx').addAisle).toBe('other');
  });
});

describe('parseGroceryEntry', () => {
  it.each([
    ['milk', 'milk', null, null],
    ['2 milk', 'milk', 2, null],
    ['2x milk', 'milk', 2, null],
    ['2 x milk', 'milk', 2, null],
    ['2 milk chocolate', 'milk chocolate', 2, null],
    ['milk x2', 'milk', 2, null],
    ['milk ×3', 'milk', 3, null],
    ['500g butter', 'butter', 500, 'g'],
    ['1.5 kg rice', 'rice', 1.5, 'kg'],
    ['1,5 L milk', 'milk', 1.5, 'L'],
    ['3 cans tomatoes', 'tomatoes', 3, 'can'],
    ['7up', '7up', null, null],
    ['0 eggs', '0 eggs', null, null],
    ['2', '2', null, null],
  ])('%s', (input, name, quantity, unit) => {
    expect(parseGroceryEntry(input)).toEqual({ name, quantity, unit });
  });

  it('formats the parsed quantity', () => {
    expect(formatEntryQuantity({ quantity: 2, unit: null })).toBe('×2');
    expect(formatEntryQuantity({ quantity: 500, unit: 'g' })).toBe('500g');
    expect(formatEntryQuantity({ quantity: 3, unit: 'can' })).toBe('3 can');
    expect(formatEntryQuantity({ quantity: null, unit: null })).toBeNull();
  });
});

describe('groceryAislesMatching', () => {
  it('matches the first word of a built-in label and custom aisle names', () => {
    expect(groceryAislesMatching('dai')).toEqual(['dairy_eggs']);
    expect(groceryAislesMatching('Produce')).toEqual(['produce']);
    expect(groceryAislesMatching('eggs')).toEqual([]);
    expect(groceryAislesMatching('da')).toEqual([]);
    expect(groceryAislesMatching('baby', [{ id: 'a', group_id: 'g', name: 'Baby stuff', color: 'pink', sort_order: 0 }])).toEqual(['Baby stuff']);
  });

  it('stops offering an aisle name as a new item', () => {
    expect(grocerySearchAddOptions([], [], 'dairy').addName).toBeNull();
    expect(grocerySearchAddOptions([], [], 'eggs').addName).toBe('eggs');
  });
});

describe('grocerySearchAddOptions quantities', () => {
  it('matches on the name and carries the quantity', () => {
    const r = grocerySearchAddOptions([item({ name: 'Oat milk' })], [], '2 milk');
    expect(r).toMatchObject({ addName: 'milk', quantity: 2, unit: null });
    expect(grocerySearchAddOptions([item({ name: 'Milk' })], [], '2 milk').addName).toBeNull();
  });
});

describe('recentGroceryPicks', () => {
  it('lists non-needed items newest first, one per name', () => {
    const picks = recentGroceryPicks([
      item({ id: 'a', name: 'Milk', status: 'needed', status_changed_at: '2026-10-10T00:00:00Z' }),
      item({ id: 'b', name: 'Bread', status: 'have', status_changed_at: '2026-10-01T00:00:00Z' }),
      item({ id: 'c', name: 'Eggs', status: 'bought', status_changed_at: '2026-10-05T00:00:00Z' }),
      item({ id: 'd', name: 'Egg', status: 'have', status_changed_at: '2026-09-01T00:00:00Z' }),
    ]);
    expect(picks.map((p) => p.id)).toEqual(['c', 'b']);
  });
});

describe('GROCERY_UNDO_LABELS', () => {
  it('names a single item and counts a batch', () => {
    expect(GROCERY_UNDO_LABELS.added(1, 'Milk')).toBe('Milk added to list');
    expect(GROCERY_UNDO_LABELS.added(3, 'Milk')).toBe('3 items added to list');
    expect(GROCERY_UNDO_LABELS.reset(2)).toBe('2 items back to Needed');
  });
});

describe("grocery Show switch", () => {
  it("parses a stored value and falls back to all", () => {
    expect(parseGroceryShow("needed")).toBe("needed");
    expect(parseGroceryShow("all")).toBe("all");
    expect(parseGroceryShow(null)).toBe("all");
    expect(parseGroceryShow("junk")).toBe("all");
  });
});

describe('unit-aware quantity steps', () => {
  it('steps and caps by unit, any case', () => {
    expect(['kg', 'G', 'litres', 'ml', null, 'pack'].map(unitQtyStep)).toEqual([0.5, 50, 0.25, 50, 1, 1]);
    expect(['kg', 'grams', 'L', 'millilitre', undefined].map(unitQtyMax)).toEqual([50, 5000, 20, 5000, 999]);
  });
});
