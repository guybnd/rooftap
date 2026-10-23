import { describe, expect, it } from 'vitest';
import {
  ingredientNameSuggestions,
  ingredientStatus,
  itemMatchLibrary,
  matchIngredientToGrocery,
  normalizeRecipeRow,
  recipeCuisines,
  recipeLineWrite,
  recipeShoppingLines,
} from './recipes';
import type { GroceryItem, Recipe, RecipeIngredient } from '../../types';

// HOUP-333: `Uncaught TypeError: t.cuisines is not iterable` took down /recipes in
// production when a single row reached the page without a cuisines array. Every
// iteration of cuisines now goes through recipeCuisines(), and recipes$ runs
// normalizeRecipeRow() over every row it receives from Supabase.

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-1',
    group_id: 'group-1',
    title: 'Shakshuka',
    cuisines: ['israeli', 'breakfast'],
    method: 'cooking',
    instructions: null,
    servings: 2,
    prep_minutes: null,
    cook_minutes: null,
    source: null,
    source_type: 'manual',
    draft: false,
    created_by: 'user-1',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

/** A row as it can actually arrive from a stale cache or a lossy payload. */
function malformed(cuisines: unknown): Recipe {
  return { ...recipe(), cuisines } as unknown as Recipe;
}

describe('recipeCuisines', () => {
  it('returns the tags for a well-formed row', () => {
    expect(recipeCuisines(recipe())).toEqual(['israeli', 'breakfast']);
  });

  it('returns [] when cuisines is missing, null, or not iterable', () => {
    const { cuisines: _dropped, ...withoutField } = recipe();
    expect(recipeCuisines(withoutField as unknown as Recipe)).toEqual([]);
    expect(recipeCuisines(malformed(null))).toEqual([]);
    expect(recipeCuisines(malformed(undefined))).toEqual([]);
    expect(recipeCuisines(malformed(42))).toEqual([]);
    expect(recipeCuisines(malformed({ 0: 'italian' }))).toEqual([]);
    expect(recipeCuisines(malformed(''))).toEqual([]);
  });

  it('keeps a bare string as a single tag instead of hiding it', () => {
    expect(recipeCuisines(malformed('  italian '))).toEqual(['italian']);
  });

  it('drops non-string members of an array', () => {
    expect(recipeCuisines(malformed(['italian', null, 3, 'quick']))).toEqual(['italian', 'quick']);
  });

  it('tolerates a missing recipe object', () => {
    expect(recipeCuisines(null)).toEqual([]);
    expect(recipeCuisines(undefined)).toEqual([]);
  });
});

describe('normalizeRecipeRow', () => {
  it('returns the same reference for a well-formed row (no churn for Legend change detection)', () => {
    const row = recipe();
    expect(normalizeRecipeRow(row)).toBe(row);
  });

  it('backfills a missing cuisines array without touching other fields', () => {
    const { cuisines: _dropped, ...withoutField } = recipe();
    const out = normalizeRecipeRow(withoutField as unknown as Recipe);
    expect(out.cuisines).toEqual([]);
    expect(out).toEqual({ ...withoutField, cuisines: [] });
  });

  it('coerces a null or string cuisines field into an array', () => {
    expect(normalizeRecipeRow(malformed(null)).cuisines).toEqual([]);
    expect(normalizeRecipeRow(malformed('italian')).cuisines).toEqual(['italian']);
  });
});

// A partial row in the local cache (no `name`) crashed the whole Recipes
// screen: "Cannot read property 'toLowerCase' of undefined at add, at
// ingredientNameSuggestions". The name helpers skip such rows instead.
describe('name helpers with a nameless cached row', () => {
  const grocery = (overrides: Partial<GroceryItem>) =>
    ({ id: 'g', name: 'Eggs', status: 'have', deleted: false, ...overrides }) as GroceryItem;
  const ingredient = (overrides: Partial<RecipeIngredient>) =>
    ({ id: 'i', name: 'Flour', item_name: null, deleted: false, ...overrides }) as RecipeIngredient;
  const nameless = <T,>(row: T) => ({ ...row, name: undefined }) as unknown as T;

  it('ingredientNameSuggestions skips rows with no name', () => {
    expect(
      ingredientNameSuggestions(
        [grocery({}), nameless(grocery({ id: 'g2' }))],
        [ingredient({}), nameless(ingredient({ id: 'i2', item_name: 'sugar' }))],
      ),
    ).toEqual(['Eggs', 'Flour']);
  });

  it('matching and the match library skip rows with no name', () => {
    const items = [nameless(grocery({ id: 'g2' })), grocery({})];
    expect(matchIngredientToGrocery('eggs', items)?.id).toBe('g');
    expect(ingredientStatus('milk', items)).toBe('none');
    expect(itemMatchLibrary(items, [nameless(ingredient({ item_name: 'Sugar' }))])).toEqual(['Eggs', 'Sugar']);
  });
});

describe('recipeShoppingLines', () => {
  const g = (o: Partial<GroceryItem>) => ({ id: 'g', name: 'Eggs', status: 'needed', deleted: false, ...o }) as GroceryItem;
  const i = (o: Partial<RecipeIngredient>) =>
    ({ id: 'i', name: 'Flour', item_name: null, quantity: null, unit: null, deleted: false, ...o }) as RecipeIngredient;

  it('folds two lines for the same item into one, with both amounts', () => {
    const lines = recipeShoppingLines(
      [
        i({ id: 'a', name: 'blood orange', quantity: 2, unit: 'count' }),
        i({ id: 'b', name: 'blood orange juice', item_name: 'Blood orange', quantity: 9, unit: 'tbsp' }),
      ],
      [],
      'Cake',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].ingredients.map((x) => x.id)).toEqual(['a', 'b']);
    expect(lines[0].note).toBe('2 count, 9 tbsp for Cake');
    expect(lines[0].match).toBeNull();
  });

  it('leaves out what you have and staples, and marks what is on the list', () => {
    const lines = recipeShoppingLines(
      [i({ id: 'a', name: 'Eggs' }), i({ id: 'b', name: 'Salt' }), i({ id: 'c', name: 'Milk' }), i({ id: 'd', name: 'Rice' })],
      [g({ id: 'e', name: 'Eggs', status: 'have' }), g({ id: 'm', name: 'milk', status: 'needed' }), g({ id: 'r', name: 'Rice', status: 'bought' })],
      'Cake',
      new Set(['salt']),
    );
    expect(lines.map((l) => [l.name, l.onList])).toEqual([
      ['milk', true],
      ['Rice', false],
    ]);
  });

  it('writes a patch for a matched item and a new row otherwise', () => {
    const [bought, fresh] = recipeShoppingLines(
      [i({ id: 'a', name: 'Rice' }), i({ id: 'b', name: 'Saffron', quantity: 1, unit: 'g' })],
      [g({ id: 'r', name: 'Rice', status: 'bought' })],
      'Paella',
    );
    const ctx = { groupId: 'grp', recipeId: 'rec', createdBy: 'u' };
    const patch = recipeLineWrite(bought, ctx);
    expect(patch).toMatchObject({ kind: 'patch', id: 'r', patch: { status: 'needed', recipe_note: 'for Paella', recipe_source_id: 'rec' } });
    const create = recipeLineWrite(fresh, ctx);
    expect(create.kind).toBe('create');
    if (create.kind === 'create') expect(create.item).toMatchObject({ name: 'Saffron', status: 'needed', recipe_note: '1 g for Paella' });
  });
});
