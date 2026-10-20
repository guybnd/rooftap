'use client';

// FLUX-189: Recipes — standalone "new recipe" route. The list header's ＋ New
// recipe button opens the sheet inline; this route is the deep-linkable
// equivalent (mounts the same shared form open, routes to the new recipe on save).

import { useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { use$ } from '@legendapp/state/react';
import { useDataCache } from '@/lib/data-cache';
import { recipes$, recipeIngredients$, groceryItems$, useReconnectSync, useStoreHelpers, recipeCuisines, useModules } from '@homeup/core';
import type { GroceryItem, Recipe, RecipeIngredient } from '@homeup/core';
import { RecipeFormSheet } from '../recipe-form-sheet';

export default function NewRecipePage() {
  const router = useRouter();
  const { group, currentUserId, loading: cacheLoading } = useDataCache();
  const modules = useModules();
  // Modules: grocery names and have/need hints in the form need recipes and
  // groceries (module-features.ts). Off means the shopping list isn't read.
  const groceriesLinked = modules.feature('recipes.groceries');

  const recs$ = recipes$(group?.id);
  const ings$ = recipeIngredients$(group?.id);
  const items$ = groceryItems$(groceriesLinked ? group?.id : undefined);
  useReconnectSync(recs$);
  useReconnectSync(ings$);
  useReconnectSync(items$);

  const { writeRow: writeRecipe } = useStoreHelpers(recs$, currentUserId);
  const { writeRow: writeIngredient } = useStoreHelpers(ings$, currentUserId);

  const groceryItems = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is GroceryItem => !!i && !i.deleted),
  );
  const allIngredients = use$(() =>
    Object.values(ings$.get() ?? {}).filter((i): i is RecipeIngredient => !!i && !i.deleted),
  );
  const allRecipes = use$(() =>
    Object.values(recs$.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted),
  );
  const cuisineSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRecipes) for (const c of recipeCuisines(r)) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allRecipes]);

  const savedId = useRef<string | null>(null);

  if (cacheLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const save = (recipe: Recipe, ingredients: RecipeIngredient[]) => {
    writeRecipe(recipe);
    ingredients.forEach(writeIngredient);
    savedId.current = recipe.id;
  };

  const close = () => {
    router.push(savedId.current ? `/recipes/${savedId.current}` : '/recipes');
  };

  return (
    <RecipeFormSheet
      isOpen
      groupId={group.id}
      groceryItems={groceryItems}
      allIngredients={allIngredients}
      cuisineSuggestions={cuisineSuggestions}
      onClose={close}
      onSave={save}
    />
  );
}
