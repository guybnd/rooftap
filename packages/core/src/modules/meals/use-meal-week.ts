'use client';

// The meal plan week behind Recipes' "This week" tab, shared by web and the
// app so the two screens read and write a week the same way: the nights with
// their recipe, cook and calendar hint, what's missing from Groceries, and
// the writes (plan a night, set who cooks, clear it, add what's missing,
// keep a draft). Stores open only while their module is on, like every
// cross-module read (store-modules.ts).

import { useCallback, useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { useReconnectSync, useStoreHelpers } from '../../data/create-group-store';
import { useStoreLoaded } from '../../data/use-store-loaded';
import { groupEvents$ } from '../../data/stores/events-store';
import { groceryItems$ } from '../../data/stores/grocery-items-store';
import { mealPlanEntries$ } from '../../data/stores/meal-plan-store';
import { recipeIngredients$ } from '../../data/stores/recipe-ingredients-store';
import { recipes$ } from '../../data/stores/recipes-store';
import { addDaysISO } from '../../date-utils';
import { buildNeededGroceryItem, recipeNoteFor } from '../recipes/recipes';
import type { GroceryItem, GroupEvent, Recipe, RecipeIngredient } from '../../types';
import {
  agendaFromEvents,
  buildMealPlanEntry,
  draftableNights,
  formatMealMinutes,
  isNightPlanned,
  mealEntriesByDate,
  mealNightHint,
  mealNightLabel,
  mealTitle,
  mealWeekDates,
  recipeMinutes,
  shadowedMealEntries,
  tonightLine,
  weekShopping,
  type MealDraftNight,
  type MealPlanEntry,
  type WeekShopping,
} from './meal-plan';

export interface MealNight {
  date: string;
  weekday: string;
  day: string;
  isToday: boolean;
  isPast: boolean;
  entry: MealPlanEntry | null;
  planned: boolean;
  /** The recipe's title or the night's label; null when nothing is planned. */
  title: string | null;
  recipe: Recipe | null;
  /** "35 min", from the recipe's prep and cook time. */
  time: string | null;
  cookUserId: string | null;
  /** A calendar hint ("Viewing at 6:30 PM, try something quick"), while Calendar is linked. */
  hint: string | null;
}

/** What to put on a night: a recipe, or a label for a night without one. */
export type MealPick = { recipeId: string } | { label: string };

export function useMealWeek(input: {
  groupId: string | null | undefined;
  currentUserId: string | null | undefined;
  weekStart: string;
  today: string;
  /** meals.groceries: read the shopping list and offer to add what's missing. */
  groceriesLinked: boolean;
  /** meals.calendar: busy evenings as hints. */
  calendarLinked: boolean;
}) {
  const { groupId, currentUserId, weekStart, today, groceriesLinked, calendarLinked } = input;

  const entries$ = mealPlanEntries$(groupId);
  const recs$ = recipes$(groupId);
  const ings$ = recipeIngredients$(groupId);
  const items$ = groceryItems$(groceriesLinked ? groupId : undefined);
  const events$ = groupEvents$(calendarLinked ? groupId : undefined);
  useReconnectSync(entries$);
  useReconnectSync(recs$);
  useReconnectSync(ings$);
  useReconnectSync(items$);
  useReconnectSync(events$);
  const loaded = useStoreLoaded(entries$, recs$);

  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(entries$, currentUserId);
  const { writeRow: writeGrocery } = useStoreHelpers(items$, currentUserId);

  const allEntries = use$(() => Object.values(entries$.get() ?? {}).filter((e): e is MealPlanEntry => !!e && !e.deleted));
  const allRecipes = use$(() => Object.values(recs$.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted && !r.draft));
  const allIngredients = use$(() =>
    Object.values(ings$.get() ?? {}).filter((i): i is RecipeIngredient => !!i && !i.deleted),
  );
  const groceryItems = use$(() => Object.values(items$.get() ?? {}).filter((i): i is GroceryItem => !!i && !i.deleted));
  const events = use$(() =>
    Object.values(events$.get() ?? {}).filter(
      (e): e is GroupEvent => !!e && !e.deleted && !(e.private && e.created_by !== currentUserId),
    ),
  );

  const recipes = useMemo(() => [...allRecipes].sort((a, b) => a.title.localeCompare(b.title)), [allRecipes]);
  const recipesById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const ingredientsByRecipe = useMemo(() => {
    const m = new Map<string, RecipeIngredient[]>();
    for (const ing of allIngredients) m.set(ing.recipe_id, [...(m.get(ing.recipe_id) ?? []), ing]);
    for (const list of m.values()) list.sort((a, b) => a.position - b.position);
    return m;
  }, [allIngredients]);

  const weekDates = useMemo(() => mealWeekDates(weekStart), [weekStart]);
  const byDate = useMemo(() => mealEntriesByDate(allEntries), [allEntries]);
  const agenda = useMemo(() => {
    if (!calendarLinked) return [];
    const from = addDaysISO(weekStart, -1);
    const to = addDaysISO(weekStart, 8);
    return agendaFromEvents(events.filter((e) => e.starts_at.slice(0, 10) >= from && e.starts_at.slice(0, 10) <= to));
  }, [calendarLinked, events, weekStart]);

  const nights = useMemo<MealNight[]>(
    () =>
      weekDates.map((date) => {
        const entry = byDate.get(date) ?? null;
        const recipe = entry?.recipe_id ? recipesById.get(entry.recipe_id) ?? null : null;
        const planned = isNightPlanned(entry, recipesById);
        const { weekday, day } = mealNightLabel(date);
        return {
          date,
          weekday,
          day,
          isToday: date === today,
          isPast: date < today,
          entry,
          planned,
          title: mealTitle(entry, recipesById),
          recipe,
          time: formatMealMinutes(recipeMinutes(recipe)),
          cookUserId: entry?.cook_user_id ?? null,
          hint: calendarLinked && date >= today ? mealNightHint(date, agenda, planned) : null,
        };
      }),
    [weekDates, byDate, recipesById, today, calendarLinked, agenda],
  );

  const plannedCount = nights.filter((n) => n.planned).length;

  const shopping = useMemo<WeekShopping | null>(
    () =>
      groceriesLinked
        ? weekShopping({
            entries: weekDates.map((d) => byDate.get(d)).filter((e): e is MealPlanEntry => !!e),
            fromDate: today > weekStart ? today : weekStart,
            recipesById,
            ingredientsByRecipe,
            groceryItems,
          })
        : null,
    [groceriesLinked, weekDates, byDate, today, weekStart, recipesById, ingredientsByRecipe, groceryItems],
  );

  const draftable = useMemo(() => draftableNights(weekDates, byDate, recipesById, today), [weekDates, byDate, recipesById, today]);

  // Older rows for a night (two people planned it offline) go once it's edited.
  const tidy = useCallback(
    (date: string, keepId: string | null) => {
      for (const e of shadowedMealEntries(allEntries, date)) if (e.id !== keepId) softDeleteRow(e.id);
    },
    [allEntries, softDeleteRow],
  );

  const setNight = useCallback(
    (date: string, pick: MealPick) => {
      if (!groupId) return;
      const current = byDate.get(date);
      const fields = 'recipeId' in pick ? { recipe_id: pick.recipeId, label: null } : { recipe_id: null, label: pick.label.trim() || null };
      if (current) {
        patchRow(current.id, fields);
        tidy(date, current.id);
      } else {
        writeRow(
          buildMealPlanEntry({
            groupId,
            date,
            recipeId: fields.recipe_id,
            label: fields.label,
            createdBy: currentUserId ?? null,
          }),
        );
      }
    },
    [groupId, byDate, patchRow, tidy, writeRow, currentUserId],
  );

  const setCook = useCallback(
    (date: string, userId: string | null) => {
      const current = byDate.get(date);
      if (current) patchRow(current.id, { cook_user_id: userId });
    },
    [byDate, patchRow],
  );

  const clearNight = useCallback(
    (date: string) => {
      const current = byDate.get(date);
      if (current) softDeleteRow(current.id);
      tidy(date, null);
    },
    [byDate, softDeleteRow, tidy],
  );

  /** Puts every missing ingredient on the grocery list; returns how many. */
  const addMissing = useCallback(
    (missing = shopping?.missing ?? []): number => {
      if (!groupId || !groceriesLinked) return 0;
      for (const m of missing) {
        writeGrocery(
          buildNeededGroceryItem({
            groupId,
            name: m.key,
            recipeNote: recipeNoteFor(m.ingredient, m.recipe.title),
            recipeSourceId: m.recipe.id,
            createdBy: currentUserId ?? null,
            quantity: m.ingredient.quantity,
            unit: m.ingredient.unit,
          }),
        );
      }
      return missing.length;
    },
    [groupId, groceriesLinked, shopping, writeGrocery, currentUserId],
  );

  /**
   * Keeps a draft: writes each drafted night that has a recipe or label, then
   * adds the kept week's missing ingredients to Groceries (when linked).
   * Returns how many nights were kept and how many items were added.
   */
  const keepDraft = useCallback(
    (draft: readonly MealDraftNight[]): { kept: number; added: number } => {
      let kept = 0;
      const planned = new Map(byDate);
      for (const night of draft) {
        const pick: MealPick | null = night.recipe_id && recipesById.has(night.recipe_id)
          ? { recipeId: night.recipe_id }
          : night.label?.trim()
            ? { label: night.label }
            : null;
        if (!pick) continue;
        setNight(night.date, pick);
        kept++;
        const draftEntry = buildMealPlanEntry({
          groupId: groupId ?? '',
          date: night.date,
          recipeId: 'recipeId' in pick ? pick.recipeId : null,
          label: 'label' in pick ? pick.label : null,
          createdBy: null,
        });
        planned.set(night.date, draftEntry);
      }
      if (!groceriesLinked) return { kept, added: 0 };
      // The writes above land in the store on the next tick, so work out the
      // missing list from the kept week directly.
      const { missing } = weekShopping({
        entries: weekDates.map((d) => planned.get(d)).filter((e): e is MealPlanEntry => !!e),
        fromDate: today > weekStart ? today : weekStart,
        recipesById,
        ingredientsByRecipe,
        groceryItems,
      });
      return { kept, added: addMissing(missing) };
    },
    [byDate, recipesById, setNight, groupId, groceriesLinked, weekDates, today, weekStart, ingredientsByRecipe, groceryItems, addMissing],
  );

  return {
    loaded,
    recipes,
    recipesById,
    ingredientsByRecipe,
    nights,
    plannedCount,
    shopping,
    draftable,
    setNight,
    setCook,
    clearNight,
    addMissing,
    keepDraft,
  };
}

/**
 * Home's one meal plan row: tonight's dinner ("Tonight: Thai green curry",
 * "35 min"), or null when tonight isn't planned or the feature is off
 * (hub.meals). Opens no store while off.
 */
export function useTonightMeal(groupId: string | null | undefined, on: boolean, today: string) {
  const entries$ = mealPlanEntries$(on ? groupId : undefined);
  const recs$ = recipes$(on ? groupId : undefined);
  const entries = use$(() => Object.values(entries$.get() ?? {}).filter((e): e is MealPlanEntry => !!e && !e.deleted && e.date === today));
  const tonightRecipeId = useMemo(() => mealEntriesByDate(entries).get(today)?.recipe_id ?? null, [entries, today]);
  const recipe = use$(() => (tonightRecipeId ? recs$.get()?.[tonightRecipeId] : undefined));
  return useMemo(() => {
    if (!on) return null;
    const recipesById = new Map<string, Recipe>(recipe && !recipe.deleted ? [[recipe.id, recipe]] : []);
    return tonightLine(entries, recipesById, today);
  }, [on, entries, recipe, today]);
}
