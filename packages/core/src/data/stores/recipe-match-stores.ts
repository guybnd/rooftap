'use client';

// Recipes scan match: the household's staples and the names it taught the
// match step. Local-first like every group store, so a scan's match step
// works on a shaky kitchen signal.

import { createGroupStore } from '../create-group-store';
import type { IngredientAlias, RecipeStaple } from '../../modules/recipes/scan-match';

export const recipeStaples$ = createGroupStore<RecipeStaple>({
  collection: 'recipe_staples',
  storageName: 'recipe_staples',
});

export const ingredientAliases$ = createGroupStore<IngredientAlias>({
  collection: 'ingredient_aliases',
  storageName: 'ingredient_aliases',
});
