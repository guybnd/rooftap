import { z } from "zod";
import {
  buildMealPlanEntry,
  planMealNight,
  isNightPlanned,
  mealDishesByDate,
  mealNightHint,
  mealRole,
  mealNightLabel,
  mealWeekRangeLabel,
  mealWeekStart,
  recipeMinutes,
  weekShopping,
  type MealPlanEntry,
} from "@homeup/core";
import { loadMealWeek, personTimeZone, todayIn } from "@/lib/meal-plan-server";
import { fail, notAllMembers, ok, toolRegistrar, type HouseholdTool, type HouseholdToolContext } from "../tool-kit";
import { loadRecipeMatch } from "./recipes-tools";

// Meal plan (Recipes > This week): "what's for dinner" and "put the curry on
// Thursday with rice". A night holds several dishes, one row each (a main
// plus sides and a dessert), or one row with a label (mealDishesByDate).
// set_meal edits the night and tidies away rows the night doesn't show.

export function mealsTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { admin, userId, enabled } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  tool(
    "get_meal_plan",
    {
      description:
        "The household's dinner plan for one week (Monday to Sunday). Each night has dishes (recipe_id, title, role main, side or dessert, minutes) or a label (Out, Leftovers, free text), who cooks (cook_user_id), and calendar hints for busy evenings. today is the person's date. With Groceries on, each night has to_buy (its ingredients not on the list or in stock), and missing lists ingredients of the planned recipes from today on that are not on the shopping list or in stock; add them with add_recipe_to_groceries. Defaults to this week; pass any date in another week to read that one.",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Any YYYY-MM-DD in the week to read; this week when left out."),
      },
    },
    async ({ date }) => {
      if (!enabled.has("recipes")) return fail("The Recipes module is off for this household");
      const timeZone = await personTimeZone(admin, userId);
      const today = todayIn(timeZone);
      const week = await loadMealWeek(admin, { userId, groupId, weekStart: mealWeekStart(date ?? today), timeZone, enabled });
      const dishesByDate = mealDishesByDate(week.entries);
      const staples = enabled.has("groceries") ? (await loadRecipeMatch(db)).staples : undefined;
      const shoppingFor = (entries: MealPlanEntry[], fromDate: string) =>
        weekShopping({
          entries,
          fromDate,
          recipesById: week.recipesById,
          ingredientsByRecipe: week.ingredientsByRecipe,
          groceryItems: week.groceryItems,
          staples,
        });
      const nights = week.weekDates.map((d) => {
        const rows = dishesByDate.get(d) ?? [];
        const entry = rows[0];
        const dishes = rows.flatMap((e) => {
          const recipe = e.recipe_id ? week.recipesById.get(e.recipe_id) : undefined;
          return recipe ? [{ recipe_id: recipe.id, title: recipe.title, role: mealRole(e), minutes: recipeMinutes(recipe) }] : [];
        });
        const planned = dishes.length > 0 || isNightPlanned(entry, week.recipesById);
        const hint = enabled.has("calendar") ? mealNightHint(d, week.agenda, planned) : null;
        return {
          date: d,
          weekday: mealNightLabel(d).weekday,
          ...(dishes.length ? { dishes } : {}),
          ...(!dishes.length && entry?.label ? { label: entry.label } : {}),
          ...(entry?.cook_user_id ? { cook_user_id: entry.cook_user_id } : {}),
          ...(entry?.note ? { note: entry.note } : {}),
          ...(enabled.has("groceries") && dishes.length && d >= today ? { to_buy: shoppingFor(rows, d).missing.length } : {}),
          ...(hint ? { hint } : {}),
        };
      });
      const shopping = enabled.has("groceries") ? shoppingFor([...dishesByDate.values()].flat(), today) : null;
      return ok({
        today,
        week: mealWeekRangeLabel(week.weekDates[0]),
        nights,
        ...(shopping
          ? { missing: shopping.missing.map((m) => ({ name: m.key, recipe_id: m.recipe.id })), already_on_list: shopping.onList }
          : {}),
      });
    },
    null,
  );

  tool(
    "set_meal",
    {
      description:
        "Plan one night's dinner. A night holds several dishes (a main plus sides and a dessert) or one label. recipe_id (from get_recipes) sets the main dish and keeps the sides; with add true it adds the recipe as another dish instead (role side by default, or main when the night has none). role (main, side, dessert) sets that recipe's role on the night. remove_recipe_id takes one dish off. label (Out, Leftovers, or a few words) replaces the whole night. cook_user_id says who cooks the night (a member's user id; null clears it). clear true empties the night. Fields left out keep their value.",
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        recipe_id: z.string().optional(),
        add: z.boolean().optional().describe("Add recipe_id as another dish instead of replacing the main."),
        role: z.enum(["main", "side", "dessert"]).optional().describe("The role of recipe_id on the night."),
        remove_recipe_id: z.string().optional().describe("Take this recipe's dish off the night."),
        label: z.string().max(60).optional(),
        cook_user_id: z.string().nullable().optional(),
        note: z.string().max(200).nullable().optional(),
        clear: z.boolean().optional(),
      },
    },
    async ({ date, recipe_id, add, role, remove_recipe_id, label, cook_user_id, note, clear }) => {
      if (!enabled.has("recipes")) return fail("The Recipes module is off for this household");
      if (recipe_id) {
        if (!(await db.rows("recipes", (q) => q.eq("id", recipe_id), "id")).length) return fail("Recipe not found");
      }
      if (cook_user_id) {
        if (await notAllMembers(db, [cook_user_id])) return fail("That person is not in this household");
      }
      const existing = await db.rows<MealPlanEntry>("meal_plan_entries", (q) => q.eq("date", date).eq("slot", "dinner"));
      const plan = planMealNight(existing, date, {
        recipeId: recipe_id ?? null,
        add: !!add,
        role: role ?? null,
        removeRecipeId: remove_recipe_id ?? null,
        label: label ?? null,
        clear: !!clear,
      });
      if ("error" in plan) return fail(plan.error);
      const dishes = plan.inserts.length + plan.keep.length;
      const shared: Partial<MealPlanEntry> = {
        ...(cook_user_id !== undefined ? { cook_user_id } : {}),
      };
      for (const [id, patch] of plan.updates) {
        await db.update("meal_plan_entries", id, { ...patch, ...shared, ...(note !== undefined && id === plan.first ? { note } : {}) });
      }
      if (Object.keys(shared).length) {
        const untouched = plan.keep.filter((id) => !plan.updates.has(id));
        await db.update("meal_plan_entries", untouched, shared);
      }
      if (note !== undefined && plan.first && !plan.updates.has(plan.first)) {
        await db.update("meal_plan_entries", plan.first, { note });
      }
      const cook = cook_user_id !== undefined ? cook_user_id : (existing.find((e) => plan.keep.includes(e.id))?.cook_user_id ?? null);
      if (plan.inserts.length) {
        await db.insert(
          "meal_plan_entries",
          plan.inserts.map((ins, i) =>
            buildMealPlanEntry({
              groupId,
              date,
              recipeId: ins.recipeId,
              label: ins.label,
              role: ins.role,
              position: ins.position,
              cookUserId: cook,
              note: i === 0 && !plan.first ? (note ?? null) : null,
              createdBy: userId,
            }),
          ),
        );
      }
      if (plan.remove.length) {
        await db.remove("meal_plan_entries", plan.remove);
      }
      return ok({ ok: true, date, ...(clear ? { cleared: true } : { dishes }) });
    },
    null,
  );

  return tools;
}
