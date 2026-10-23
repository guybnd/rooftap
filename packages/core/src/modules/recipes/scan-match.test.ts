import { describe, expect, it } from 'vitest';
import {
  aliasMap,
  isStaple,
  matchIngredientName,
  scannedItemName,
  stapleKeys,
  stapleList,
  summarizeScanMatch,
  withoutStaples,
  type IngredientAlias,
  type MatchContext,
  type RecipeStaple,
} from './scan-match';
import { canBeMade, recipeHaveCount } from './recipes';
import type { GroceryItem, RecipeIngredient } from '../../types';

function staple(name: string, on: boolean, updated_at = '2026-10-23T00:00:00Z'): RecipeStaple {
  return { id: name, group_id: 'g', name, staple: on, created_by: null, created_at: updated_at, updated_at, deleted: false };
}

function alias(from: string, to: string, updated_at = '2026-10-23T00:00:00Z'): IngredientAlias {
  return { id: from + to, group_id: 'g', alias: from, item_name: to, created_by: null, created_at: updated_at, updated_at, deleted: false };
}

function ing(name: string, item_name: string | null, position = 0): RecipeIngredient {
  return {
    id: `${name}-${position}`,
    recipe_id: 'r',
    group_id: 'g',
    name,
    item_name,
    quantity: null,
    unit: null,
    position,
    created_at: '',
    updated_at: '',
    deleted: false,
  };
}

function grocery(name: string, status: GroceryItem['status']): GroceryItem {
  return { id: name, name, status, deleted: false } as GroceryItem;
}

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  library: ['Risotto rice', 'White wine', 'Chicken stock', 'Egg', 'Parmesan'],
  staples: stapleKeys([]),
  aliases: new Map(),
  ...over,
});

describe('staples', () => {
  it('starts with the defaults and lets a household add and remove', () => {
    const keys = stapleKeys([staple('Rice', true), staple('Water', false)]);
    expect(keys.has('salt')).toBe(true);
    expect(keys.has('rice')).toBe(true);
    expect(keys.has('water')).toBe(false);
    expect(stapleList([staple('Rice', true), staple('Water', false)])).toEqual(['Salt', 'Pepper', 'Black pepper', 'Olive oil', 'Vegetable oil', 'Rice']);
  });

  it('the newest row for a name wins', () => {
    const keys = stapleKeys([staple('Rice', false, '2026-10-24T00:00:00Z'), staple('Rice', true, '2026-10-23T00:00:00Z')]);
    expect(keys.has('rice')).toBe(false);
  });

  it('reads combined and qualified lines', () => {
    const keys = stapleKeys([]);
    expect(isStaple('Salt and black pepper', keys)).toBe(true);
    expect(isStaple('salt, pepper', keys)).toBe(true);
    expect(isStaple('Sea salt', keys)).toBe(true);
    expect(isStaple('freshly ground black pepper', keys)).toBe(true);
    expect(isStaple('Extra virgin olive oil', keys)).toBe(true);
    expect(isStaple('boiling water', keys)).toBe(true);
    // Not the pepper grinder.
    expect(isStaple('Peppers', keys)).toBe(false);
    expect(isStaple('Red pepper', keys)).toBe(false);
    expect(isStaple('Salt and chilli', keys)).toBe(false);
    expect(isStaple('ground cumin', keys)).toBe(false);
  });

  it('count as have, and stay off the shopping list', () => {
    const items = [grocery('Egg', 'have')];
    const ings = [ing('2 eggs', 'Egg', 0), ing('pinch of salt', 'Salt', 1)];
    const keys = stapleKeys([]);
    expect(canBeMade(ings, items)).toBe(false);
    expect(canBeMade(ings, items, keys)).toBe(true);
    expect(recipeHaveCount(ings, items, keys)).toEqual({ have: 2, total: 2 });
    expect(withoutStaples(ings, keys).map((i) => i.name)).toEqual(['2 eggs']);
  });
});

describe('matching a scanned name', () => {
  it('links exact and plural names on its own', () => {
    expect(matchIngredientName('chicken stock', ctx())).toEqual({ kind: 'matched', item: 'Chicken stock', via: 'exact' });
    expect(matchIngredientName('eggs', ctx())).toEqual({ kind: 'matched', item: 'Egg', via: 'plural' });
  });

  it('asks about a close name and calls an unknown one new', () => {
    expect(matchIngredientName('dry white wine', ctx())).toEqual({ kind: 'check', item: 'White wine' });
    expect(matchIngredientName('Shallots', ctx())).toEqual({ kind: 'new', item: 'Shallots' });
    expect(matchIngredientName('Salt', ctx())).toEqual({ kind: 'staple' });
  });

  it('a taught name links silently next time', () => {
    const aliases = aliasMap([alias('Arborio rice', 'Risotto rice')]);
    expect(matchIngredientName('arborio rice', ctx({ aliases }))).toEqual({ kind: 'matched', item: 'Risotto rice', via: 'alias' });
    expect(scannedItemName('arborio rice', ctx({ aliases }))).toBe('Risotto rice');
  });

  it('a "New" answer stops the question', () => {
    const aliases = aliasMap([alias('arborio rice', 'arborio rice')]);
    expect(matchIngredientName('arborio rice', ctx({ aliases }))).toEqual({ kind: 'new', item: 'arborio rice' });
    expect(scannedItemName('arborio rice', ctx({ aliases }))).toBe('arborio rice');
  });

  it('checks the full line for an alias too', () => {
    const aliases = aliasMap([alias('dry white wine', 'White wine')]);
    expect(matchIngredientName('wine', ctx({ aliases, library: [] }), 'dry white wine')).toEqual({ kind: 'matched', item: 'White wine', via: 'alias' });
  });
});

describe('summarizeScanMatch', () => {
  it('splits the scan into the match step sections, in order', () => {
    const items = [grocery('Chicken stock', 'have'), grocery('Parmesan', 'needed')];
    const ings = [
      ing('1 litre hot chicken stock', 'Chicken stock', 0),
      ing('100 ml dry white wine', 'dry white wine', 1),
      ing('60 g parmesan', 'parmesan', 2),
      ing('2 shallots', 'Shallots', 3),
      ing('Salt and black pepper', 'Salt', 4),
    ];
    const s = summarizeScanMatch(ings, items, ctx());
    expect(s.check.map((r) => r.ingredient.position)).toEqual([1]);
    expect(s.fresh.map((r) => r.ingredient.position)).toEqual([3]);
    expect(s.matched.map((r) => r.ingredient.position)).toEqual([0, 2]);
    expect(s.matched.map((r) => r.grocery?.status)).toEqual(['have', 'needed']);
    expect(s.staples.map((r) => r.ingredient.position)).toEqual([4]);
    expect(s.total).toBe(5);
  });
});
