'use client';

// FLUX-189: recipe ingredients local-first store (child of recipes). Mirrors
// checklist-items-store.ts.

import { createGroupStore } from '../create-group-store';
import type { RecipeIngredient } from '../../types';

export const recipeIngredients$ = createGroupStore<RecipeIngredient>({
  collection: 'recipe_ingredients',
  storageName: 'recipe_ingredients',
});
