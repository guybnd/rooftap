'use client';

// The meal plan week behind Recipes' "This week" tab, shared by web and the
// app so the two screens read and write a week the same way: the nights with
// their dishes, cook and calendar hint, what's missing from Groceries, and
// the writes (plan a night, add or remove a dish, set who cooks, clear it,
// add what's missing, keep a draft). Stores open only while their module is on, like every
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
import { useRecipeMatch } from '../recipes/use-recipe-match';
import type { GroceryItem, GroupEvent, Recipe, RecipeIngredient } from '../../types';
import {
  agendaFromEvents,
  buildMealPlanEntry,
  dishesMinutes,
  dishesTitle,
  draftableNights,
  formatMealMinutes,
  isNightPlanned,
  mealDishesByDate,
  mealNightHint,
  mealNightLabel,
  mealRole,
  mealTitle,
  mealWeekDates,
  nextDishPosition,
  nextDishRole,
  recipeMinutes,
  shadowedMealEntries,
  tonightLine,
  weekShopping,
  type MealDraftNight,
  type MealPlanEntry,
  type MealRole,
  type WeekShopping,
} from './meal-plan';

/** One dish on a night. */
export interface MealDish {
  entry: MealPlanEntry;
  recipe: Recipe;
  role: MealRole;
  /** "35 min", from the recipe's prep and cook time. */
  time: string | null;
}

export interface MealNight {
  date: string;
  weekday: string;
  day: string;
  isToday: boolean;
  isPast: boolean;
  /** The night's first row: its main dish, or its label. */
  entry: MealPlanEntry | null;
  /** The night's recipes in order (mains, sides, dessert); empty on a label night. */
  dishes: MealDish[];
  planned: boolean;
  /** "Roast chicken + 2 sides", or the night's label; null when nothing is planned. */
  title: string | null;
  /** The main's recipe. */
  recipe: Recipe | null;
  /** "35 min": the longest dish, since dishes cook side by side. */
  time: string | null;
  /** With Groceries linked: the night's ingredients not on the list or in stock. */
  toBuy: number | null;
  cookUserId: string | null;
  /** A calendar hint ("Viewing at 6:30 PM, try something quick"), while Calendar is linked. */
  hint: string | null;
}

/**
 * A planned night's meta line parts, up to three: "1 h 10 min", "3 dishes",
 * "Guy cooks", "2 to buy" or "all in stock", the note, the calendar hint.
 */
export function mealNightMeta(night: MealNight, cook: string | null): string[] {
  const dishes = night.dishes.length > 1 ? `${night.dishes.length} dishes` : null;
  const toBuy = night.toBuy == null || night.isPast ? null : night.toBuy === 0 ? 'all in stock' : `${night.toBuy} to buy`;
  return [night.time, dishes, cook ? `${cook} cooks` : null, toBuy, night.entry?.note, night.hint]
    .filter((p): p is string => !!p)
    .slice(0, 3);
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
  /**
   * The server has several dishes per night (server-features.ts,
   * meals.multi-dish). Off, a night is one row and the newest wins, and no
   * write sends the dish columns.
   */
  multiDish: boolean;
}) {
  const { groupId, currentUserId, weekStart, today, groceriesLinked, calendarLinked, multiDish } = input;

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
  const { staples } = useRecipeMatch(groupId, currentUserId);

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
  const dishesByDate = useMemo(() => mealDishesByDate(allEntries, 'dinner', multiDish), [allEntries, multiDish]);
  const byDate = useMemo(() => new Map([...dishesByDate].map(([date, rows]) => [date, rows[0]])), [dishesByDate]);
  /** Every recipe row in the week, for the shopping counts. */
  const weekDishes = useMemo(
    () => weekDates.flatMap((d) => (dishesByDate.get(d) ?? []).filter((e) => e.recipe_id)),
    [weekDates, dishesByDate],
  );
  const agenda = useMemo(() => {
    if (!calendarLinked) return [];
    const from = addDaysISO(weekStart, -1);
    const to = addDaysISO(weekStart, 8);
    return agendaFromEvents(events.filter((e) => e.starts_at.slice(0, 10) >= from && e.starts_at.slice(0, 10) <= to));
  }, [calendarLinked, events, weekStart]);

  const nights = useMemo<MealNight[]>(
    () =>
      weekDates.map((date) => {
        const rows = dishesByDate.get(date) ?? [];
        const entry = rows[0] ?? null;
        const dishes: MealDish[] = rows.flatMap((e) => {
          const recipe = e.recipe_id ? recipesById.get(e.recipe_id) : undefined;
          return recipe ? [{ entry: e, recipe, role: mealRole(e), time: formatMealMinutes(recipeMinutes(recipe)) }] : [];
        });
        const planned = dishes.length > 0 || isNightPlanned(entry, recipesById);
        const { weekday, day } = mealNightLabel(date);
        const toBuy =
          groceriesLinked && dishes.length > 0
            ? weekShopping({
                entries: dishes.map((d) => d.entry),
                fromDate: date,
                recipesById,
                ingredientsByRecipe,
                groceryItems,
                staples,
              }).missing.length
            : null;
        return {
          date,
          weekday,
          day,
          isToday: date === today,
          isPast: date < today,
          entry,
          dishes,
          planned,
          title: dishesTitle(rows, recipesById) ?? mealTitle(entry, recipesById),
          recipe: dishes[0]?.recipe ?? null,
          time: formatMealMinutes(dishesMinutes(rows, recipesById)),
          toBuy,
          cookUserId: entry?.cook_user_id ?? null,
          hint: calendarLinked && date >= today ? mealNightHint(date, agenda, planned) : null,
        };
      }),
    [weekDates, dishesByDate, recipesById, ingredientsByRecipe, groceryItems, staples, groceriesLinked, today, calendarLinked, agenda],
  );

  const plannedCount = nights.filter((n) => n.planned).length;

  const shopping = useMemo<WeekShopping | null>(
    () =>
      groceriesLinked
        ? weekShopping({
            entries: weekDishes,
            fromDate: today > weekStart ? today : weekStart,
            recipesById,
            ingredientsByRecipe,
            groceryItems,
            staples,
          })
        : null,
    [groceriesLinked, weekDishes, today, weekStart, recipesById, ingredientsByRecipe, groceryItems, staples],
  );

  const draftable = useMemo(() => draftableNights(weekDates, byDate, recipesById, today), [weekDates, byDate, recipesById, today]);

  // Rows a night doesn't show (two people planned it offline) go once it's edited.
  const tidy = useCallback(
    (date: string, keepIds: readonly string[]) => {
      for (const e of shadowedMealEntries(allEntries, date, 'dinner', multiDish)) if (!keepIds.includes(e.id)) softDeleteRow(e.id);
    },
    [allEntries, multiDish, softDeleteRow],
  );

  /** The dish columns, only for a server that has them. */
  const dishFields = useCallback(
    (role: MealRole | null, position: number) => (multiDish ? { role, position } : {}),
    [multiDish],
  );

  /**
   * Plans a night. A recipe replaces the main dish and keeps the sides; a
   * label replaces the whole night.
   */
  const setNight = useCallback(
    (date: string, pick: MealPick) => {
      if (!groupId) return;
      const rows = dishesByDate.get(date) ?? [];
      const current = rows[0];
      if ('recipeId' in pick) {
        if (current) {
          // The recipe is already a side: it becomes the main in its own row.
          const already = rows.find((e) => e.recipe_id === pick.recipeId && e.id !== current.id);
          if (already) softDeleteRow(already.id);
          patchRow(current.id, { recipe_id: pick.recipeId, label: null, ...(current.recipe_id ? {} : dishFields('main', 0)) });
          tidy(date, rows.map((e) => e.id));
          return;
        }
        writeRow(buildMealPlanEntry({ groupId, date, recipeId: pick.recipeId, createdBy: currentUserId ?? null, ...dishFields('main', 0) }));
        return;
      }
      const label = pick.label.trim() || null;
      if (current) {
        patchRow(current.id, { recipe_id: null, label, ...dishFields(null, 0) });
        for (const e of rows.slice(1)) softDeleteRow(e.id);
        tidy(date, [current.id]);
        return;
      }
      writeRow(buildMealPlanEntry({ groupId, date, label, createdBy: currentUserId ?? null }));
    },
    [groupId, dishesByDate, patchRow, softDeleteRow, tidy, writeRow, currentUserId, dishFields],
  );

  /** Adds a recipe as another dish on the night: a main when it has none, else a side. */
  const addDish = useCallback(
    (date: string, recipeId: string) => {
      if (!groupId) return;
      const rows = dishesByDate.get(date) ?? [];
      const recipes = rows.filter((e) => e.recipe_id);
      if (!multiDish || recipes.length === 0) {
        setNight(date, { recipeId });
        return;
      }
      if (recipes.some((e) => e.recipe_id === recipeId)) return;
      writeRow(
        buildMealPlanEntry({
          groupId,
          date,
          recipeId,
          cookUserId: recipes[0].cook_user_id,
          createdBy: currentUserId ?? null,
          role: nextDishRole(recipes),
          position: nextDishPosition(recipes),
        }),
      );
    },
    [groupId, dishesByDate, multiDish, setNight, writeRow, currentUserId],
  );

  /** Takes one dish off its night. Taking off the only main makes the next dish the main. */
  const removeDish = useCallback(
    (entryId: string) => {
      const entry = allEntries.find((e) => e.id === entryId);
      if (!entry) return;
      softDeleteRow(entryId);
      if (!multiDish || mealRole(entry) !== 'main') return;
      const rest = (dishesByDate.get(entry.date) ?? []).filter((e) => e.id !== entryId && e.recipe_id);
      if (rest.length > 0 && !rest.some((e) => mealRole(e) === 'main')) patchRow(rest[0].id, { role: 'main' });
    },
    [allEntries, softDeleteRow, multiDish, dishesByDate, patchRow],
  );

  const setDishRole = useCallback(
    (entryId: string, role: MealRole) => {
      if (multiDish) patchRow(entryId, { role });
    },
    [multiDish, patchRow],
  );

  /** Who cooks the night: every dish on it. */
  const setCook = useCallback(
    (date: string, userId: string | null) => {
      for (const e of dishesByDate.get(date) ?? []) patchRow(e.id, { cook_user_id: userId });
    },
    [dishesByDate, patchRow],
  );

  const clearNight = useCallback(
    (date: string) => {
      for (const e of dishesByDate.get(date) ?? []) softDeleteRow(e.id);
      tidy(date, []);
    },
    [dishesByDate, softDeleteRow, tidy],
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
      const planned = new Map(dishesByDate);
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
        planned.set(night.date, [draftEntry]);
      }
      if (!groceriesLinked) return { kept, added: 0 };
      // The writes above land in the store on the next tick, so work out the
      // missing list from the kept week directly.
      const { missing } = weekShopping({
        entries: weekDates.flatMap((d) => planned.get(d) ?? []),
        fromDate: today > weekStart ? today : weekStart,
        recipesById,
        ingredientsByRecipe,
        groceryItems,
        staples,
      });
      return { kept, added: addMissing(missing) };
    },
    [dishesByDate, recipesById, setNight, groupId, groceriesLinked, weekDates, today, weekStart, ingredientsByRecipe, groceryItems, staples, addMissing],
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
    multiDish,
    setNight,
    addDish,
    removeDish,
    setDishRole,
    setCook,
    clearNight,
    addMissing,
    keepDraft,
  };
}

/**
 * Home's one meal plan row: tonight's dinner ("Tonight: Roast chicken + 2
 * sides", "35 min"), or null when tonight isn't planned or the feature is off
 * (hub.meals). Opens no store while off.
 */
export function useTonightMeal(groupId: string | null | undefined, on: boolean, today: string, multiDish = true) {
  const entries$ = mealPlanEntries$(on ? groupId : undefined);
  const recs$ = recipes$(on ? groupId : undefined);
  const entries = use$(() => Object.values(entries$.get() ?? {}).filter((e): e is MealPlanEntry => !!e && !e.deleted && e.date === today));
  const recipeIds = useMemo(
    () => (mealDishesByDate(entries, 'dinner', multiDish).get(today) ?? []).flatMap((e) => (e.recipe_id ? [e.recipe_id] : [])),
    [entries, today, multiDish],
  );
  const recipes = use$(() => recipeIds.map((id) => recs$.get()?.[id]).filter((r): r is Recipe => !!r && !r.deleted));
  return useMemo(() => {
    if (!on) return null;
    const recipesById = new Map<string, Recipe>(recipes.map((r) => [r.id, r]));
    return tonightLine(entries, recipesById, today, multiDish);
  }, [on, entries, recipes, today, multiDish]);
}
