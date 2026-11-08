'use client';

// Recipes: what the "New recipe" form needs wherever it opens: the Recipes
// list, the + capture menu (over any screen) and the /recipes/new link.
// Grocery names and have/need hints need Recipes and Groceries both on
// (module-features.ts). Off means the shopping list isn't read.

import { useCallback, useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { recipes$, recipeIngredients$, groceryItems$ } from '../../data/stores';
import { useReconnectSync, useStoreHelpers } from '../../data/create-group-store';
import { useModules } from '../../modules-store';
import { recipeCuisines } from './recipes';
import type { GroceryItem, Recipe, RecipeIngredient } from '../../types';

function live<T extends { deleted: boolean }>(record: Record<string, T | undefined> | undefined): T[] {
  return Object.values(record ?? {}).filter((r): r is T => !!r && !r.deleted);
}

export function useNewRecipe(groupId: string | null | undefined, currentUserId: string | null | undefined) {
  const modules = useModules();
  const groceriesLinked = modules.feature('recipes.groceries');
  const gid = groupId ?? undefined;

  const recs$ = recipes$(gid);
  const ings$ = recipeIngredients$(gid);
  const items$ = groceryItems$(groceriesLinked ? gid : undefined);
  useReconnectSync(recs$);
  useReconnectSync(ings$);
  useReconnectSync(items$);

  const { writeRow: writeRecipe } = useStoreHelpers(recs$, currentUserId ?? null);
  const { writeRow: writeIngredient } = useStoreHelpers(ings$, currentUserId ?? null);

  const groceryItems = use$(() => live<GroceryItem>(items$.get()));
  const allIngredients = use$(() => live<RecipeIngredient>(ings$.get()));
  const allRecipes = use$(() => live<Recipe>(recs$.get()));
  const cuisineSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRecipes) for (const c of recipeCuisines(r)) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allRecipes]);

  /** Write a new recipe and its ingredient rows. */
  const saveRecipe = useCallback(
    (recipe: Recipe, ingredients: RecipeIngredient[]) => {
      writeRecipe(recipe);
      ingredients.forEach(writeIngredient);
    },
    [writeRecipe, writeIngredient],
  );

  return { groceryItems, allIngredients, cuisineSuggestions, saveRecipe };
}
