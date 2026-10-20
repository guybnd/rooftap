// HOUP-93: native Recipes — standalone "new recipe" route, the deep-linkable
// equivalent of the list header's + New button. Faithful port of
// apps/web/src/app/recipes/new/page.tsx.
import * as React from 'react';
import { ActivityIndicator } from 'react-native';
import { use$ } from '@legendapp/state/react';
import { useRouter, type Href } from 'expo-router';
import { RecipeFormSheet } from '@/features/recipes/recipe-form-sheet';
import { ScreenBackground } from '@homeup/ui';
import {
  recipes$,
  recipeIngredients$,
  groceryItems$,
  useReconnectSync,
  useStoreHelpers,
  useModules,
  recipeCuisines,
  type GroceryItem,
  type Recipe,
  type RecipeIngredient,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { useOpenRoute } from '@/lib/tab-routes';

export default function NewRecipeScreen() {
  const router = useRouter();
  const openRoute = useOpenRoute();
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
    Object.values(items$.get() ?? {}).filter((i): i is GroceryItem => !!i && !i.deleted)
  );
  const allIngredients = use$(() =>
    Object.values(ings$.get() ?? {}).filter((i): i is RecipeIngredient => !!i && !i.deleted)
  );
  const allRecipes = use$(() => Object.values(recs$.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted));
  const cuisineSuggestions = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of allRecipes) for (const c of recipeCuisines(r)) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allRecipes]);

  const savedId = React.useRef<string | null>(null);

  if (cacheLoading) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  const save = (recipe: Recipe, ingredients: RecipeIngredient[]) => {
    writeRecipe(recipe);
    ingredients.forEach(writeIngredient);
    savedId.current = recipe.id;
  };

  const close = (open: boolean) => {
    if (open) return;
    if (savedId.current) router.replace(`/recipes/${savedId.current}` as Href);
    else openRoute('/recipes');
  };

  return (
    <ScreenBackground>
      <RecipeFormSheet
        open
        onOpenChange={close}
        groupId={group.id}
        groceryItems={groceryItems}
        allIngredients={allIngredients}
        cuisineSuggestions={cuisineSuggestions}
        onSave={save}
      />
    </ScreenBackground>
  );
}
