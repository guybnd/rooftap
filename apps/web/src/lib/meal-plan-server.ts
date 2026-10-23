import type { SupabaseClient } from "@supabase/supabase-js";
import {
  agendaFromEvents,
  localDateTime,
  mealWeekDates,
  type GroceryItem,
  type GroupEvent,
  type MealAgendaItem,
  type MealPlanEntry,
  type ModuleId,
  type Recipe,
  type RecipeIngredient,
} from "@homeup/core";
import { visibleEvents, visibleGroceryItems } from "@/lib/pat";

// The meal plan as the server reads it, for the assistant's meal tools and
// Draft my week: the household's recipes, a week of nights, and (while their
// modules are on) the grocery list and the week's calendar. The admin client
// bypasses RLS, so every read is scoped to the group and the person's view of
// private rows, like the household tools.

export interface MealWeekData {
  weekDates: string[];
  recipes: Recipe[];
  recipesById: Map<string, Recipe>;
  ingredientsByRecipe: Map<string, RecipeIngredient[]>;
  entries: MealPlanEntry[];
  groceryItems: GroceryItem[];
  agenda: MealAgendaItem[];
}

/** The person's time zone (Settings), so "tonight" and evening times are theirs, not the server's. */
export async function personTimeZone(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from("user_settings").select("timezone").eq("user_id", userId).maybeSingle();
  const tz = (data?.timezone as string | undefined) || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Today's date where the person is. */
export function todayIn(timeZone: string, now = new Date()): string {
  return localDateTime(now.toISOString(), timeZone).date;
}

export async function loadMealWeek(
  admin: SupabaseClient,
  input: { userId: string; groupId: string; weekStart: string; timeZone: string; enabled: ReadonlySet<ModuleId> },
): Promise<MealWeekData> {
  const { userId, groupId, weekStart, timeZone, enabled } = input;
  const weekDates = mealWeekDates(weekStart);
  const from = weekDates[0];
  const to = weekDates[weekDates.length - 1];
  // A day either side of the week, so an event's UTC instant can't fall outside the window.
  const eventsFrom = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString();
  const eventsTo = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000).toISOString();

  const [recipeRes, ingredientRes, entryRes, groceryRes, eventRes] = await Promise.all([
    admin.from("recipes").select("*").eq("group_id", groupId).eq("deleted", false).eq("draft", false),
    admin.from("recipe_ingredients").select("*").eq("group_id", groupId).eq("deleted", false),
    admin.from("meal_plan_entries").select("*").eq("group_id", groupId).eq("deleted", false).gte("date", from).lte("date", to),
    enabled.has("groceries")
      ? admin.from("grocery_items").select("*").eq("group_id", groupId).eq("deleted", false)
      : Promise.resolve({ data: [] }),
    enabled.has("calendar")
      ? admin.from("events").select("*").eq("group_id", groupId).eq("deleted", false).gte("starts_at", eventsFrom).lt("starts_at", eventsTo)
      : Promise.resolve({ data: [] }),
  ]);

  const recipes = ((recipeRes.data ?? []) as Recipe[]).sort((a, b) => a.title.localeCompare(b.title));
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const ingredientsByRecipe = new Map<string, RecipeIngredient[]>();
  for (const ing of ((ingredientRes.data ?? []) as RecipeIngredient[]).sort((a, b) => a.position - b.position)) {
    if (!recipesById.has(ing.recipe_id)) continue;
    ingredientsByRecipe.set(ing.recipe_id, [...(ingredientsByRecipe.get(ing.recipe_id) ?? []), ing]);
  }
  const agenda = agendaFromEvents(visibleEvents((eventRes.data ?? []) as GroupEvent[], userId), timeZone).filter(
    (a) => a.date >= from && a.date <= to,
  );
  return {
    weekDates,
    recipes,
    recipesById,
    ingredientsByRecipe,
    entries: (entryRes.data ?? []) as MealPlanEntry[],
    groceryItems: visibleGroceryItems((groceryRes.data ?? []) as GroceryItem[], userId),
    agenda,
  };
}
