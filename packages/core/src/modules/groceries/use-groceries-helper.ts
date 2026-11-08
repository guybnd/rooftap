'use client';

// The Groceries helper's brief on the device (module-helpers.ts): the list,
// what this week's planned dinners still need, and what is running low, read
// from the synced stores so the chat opens on it at once, offline too. Its
// rows act straight away, with no AI: a missing ingredient goes on the list,
// a low item goes back to needed. Stores of other modules open only while
// the link to them is on (store-modules.ts).

import { useCallback, useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { useReconnectSync, useStoreHelpers } from '../../data/create-group-store';
import { groceryItems$ } from '../../data/stores/grocery-items-store';
import { mealPlanEntries$ } from '../../data/stores/meal-plan-store';
import { recipeIngredients$ } from '../../data/stores/recipe-ingredients-store';
import { recipes$ } from '../../data/stores/recipes-store';
import { groceryNeededAgainPatch } from '../../home/home-groceries';
import type { BriefSection, HelperBrief } from '../../module-helpers';
import type { GroceryItem, Recipe, RecipeIngredient } from '../../types';
import type { MealPlanEntry } from '../meals/meal-plan';
import { buildNeededGroceryItem, recipeNoteFor } from '../recipes/recipes';
import { useRecipeMatch } from '../recipes/use-recipe-match';
import { briefMissing, groceriesBrief } from './helper-brief';

export interface HelperBriefState {
  brief: HelperBrief | null;
  /** Puts one suggested row on the list. */
  add: (key: string) => void;
  /** Runs a row's action (readd). */
  act: (id: string) => void;
  /** The section header's action, on every row. Returns how many changed. */
  all: (section: BriefSection) => number;
}

export function useGroceriesHelper(input: {
  groupId: string | null | undefined;
  currentUserId: string | null | undefined;
  /** YYYY-MM-DD. */
  today: string;
  /** meals.groceries is on: read the meal plan for what dinners need. */
  mealsLinked: boolean;
}): HelperBriefState {
  const { groupId, currentUserId, today, mealsLinked } = input;
  const items$ = groceryItems$(groupId ?? undefined);
  const mealGroup = mealsLinked && groupId ? groupId : undefined;
  const entries$ = mealPlanEntries$(mealGroup);
  const recs$ = recipes$(mealGroup);
  const ings$ = recipeIngredients$(mealGroup);
  useReconnectSync(items$);
  const { writeRow, patchRow } = useStoreHelpers(items$, currentUserId);
  const { staples } = useRecipeMatch(mealGroup, currentUserId);

  const items = use$(() =>
    Object.values(items$.get() ?? {}).filter(
      (i): i is GroceryItem => !!i && !i.deleted && !(i.private && i.assigned_to !== currentUserId)
    )
  );
  const entries = use$(() => Object.values(entries$.get() ?? {}).filter((e): e is MealPlanEntry => !!e && !e.deleted));
  const recipeRows = use$(() => Object.values(recs$.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted));
  const ingredientRows = use$(() => Object.values(ings$.get() ?? {}).filter((i): i is RecipeIngredient => !!i && !i.deleted));

  const missing = useMemo(() => {
    if (!mealGroup) return null;
    const recipesById = new Map(recipeRows.map((r) => [r.id, r]));
    const ingredientsByRecipe = new Map<string, RecipeIngredient[]>();
    for (const ing of ingredientRows) ingredientsByRecipe.set(ing.recipe_id, [...(ingredientsByRecipe.get(ing.recipe_id) ?? []), ing]);
    return briefMissing({ entries, today, recipesById, ingredientsByRecipe, groceryItems: items, staples });
  }, [mealGroup, entries, recipeRows, ingredientRows, items, staples, today]);

  const brief = useMemo(() => (groupId ? groceriesBrief({ items, today, missing }) : null), [groupId, items, today, missing]);

  const add = useCallback(
    (key: string) => {
      const m = missing?.find((x) => x.key === key);
      if (!m || !groupId) return;
      writeRow(
        buildNeededGroceryItem({
          groupId,
          name: m.key,
          recipeNote: recipeNoteFor(m.ingredient, m.recipeTitle),
          recipeSourceId: m.recipeId,
          createdBy: currentUserId ?? null,
          quantity: m.ingredient.quantity,
          unit: m.ingredient.unit,
        })
      );
    },
    [missing, groupId, writeRow, currentUserId]
  );

  const act = useCallback((id: string) => patchRow(id, groceryNeededAgainPatch(new Date().toISOString())), [patchRow]);

  const all = useCallback(
    (section: BriefSection) => {
      let n = 0;
      for (const row of section.rows) {
        if (row.kind === 'suggest') add(row.key);
        else if (row.action) act(row.id);
        else continue;
        n++;
      }
      return n;
    },
    [add, act]
  );

  return { brief, add, act, all };
}
