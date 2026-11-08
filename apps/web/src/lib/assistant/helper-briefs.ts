import type { SupabaseClient } from "@supabase/supabase-js";
import {
  briefMissing,
  dinnersBrief,
  giftsBrief,
  groceriesBrief,
  moneyBrief,
  weekBrief,
  type CostItem,
  type GiftIdea,
  type HouseholdTask,
  type Occasion,
  stapleKeys,
  type GroceryItem,
  type HelperBrief,
  type MealPlanEntry,
  type ModuleId,
  type Recipe,
  type RecipeIngredient,
  type RecipeStaple,
} from "@homeup/core";
import { visibleGroceryItems, visibleTasks } from "@/lib/pat";
import { todayIn } from "@/lib/meal-plan-server";

// A module helper's brief on the server (core module-helpers.ts): the same
// pure function the apps run on their stores, fed from the database with the
// asking person's view (private rows of others left out), so the prompt says
// what the chat shows. In a chat the household shares, nobody's private rows
// go in, since everyone reads the replies. The admin client bypasses RLS, so every read is scoped
// to the group by hand, like the household tools.

export interface HelperBriefContext {
  admin: SupabaseClient;
  groupId: string;
  userId: string;
  enabled: ReadonlySet<ModuleId>;
  timeZone: string;
  now?: Date;
  /** The chat is one the household shares: rows anyone keeps private stay out, the asker's too. */
  shared?: boolean;
}

/** The week's missing ingredients need Recipes and Meals on with Groceries (feature meals.groceries). */
function mealsLinked(enabled: ReadonlySet<ModuleId>): boolean {
  return enabled.has("groceries" as ModuleId) && enabled.has("meals" as ModuleId) && enabled.has("recipes" as ModuleId);
}

async function groceries(ctx: HelperBriefContext): Promise<HelperBrief> {
  const today = todayIn(ctx.timeZone, ctx.now);
  const linked = mealsLinked(ctx.enabled);
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const [itemRes, entryRes, recipeRes, ingredientRes, stapleRes] = await Promise.all([
    ctx.admin.from("grocery_items").select("*").eq("group_id", ctx.groupId).eq("deleted", false),
    linked
      ? ctx.admin.from("meal_plan_entries").select("*").eq("group_id", ctx.groupId).eq("deleted", false).gte("date", today).lte("date", last)
      : Promise.resolve({ data: [] }),
    linked ? ctx.admin.from("recipes").select("*").eq("group_id", ctx.groupId).eq("deleted", false) : Promise.resolve({ data: [] }),
    linked ? ctx.admin.from("recipe_ingredients").select("*").eq("group_id", ctx.groupId).eq("deleted", false) : Promise.resolve({ data: [] }),
    linked ? ctx.admin.from("recipe_staples").select("*").eq("group_id", ctx.groupId).eq("deleted", false) : Promise.resolve({ data: [] }),
  ]);
  const visible = visibleGroceryItems((itemRes.data ?? []) as GroceryItem[], ctx.userId);
  const items = ctx.shared ? visible.filter((i) => !i.private) : visible;
  let missing = null;
  if (linked) {
    const recipes = (recipeRes.data ?? []) as Recipe[];
    const recipesById = new Map(recipes.map((r) => [r.id, r]));
    const ingredientsByRecipe = new Map<string, RecipeIngredient[]>();
    for (const ing of ((ingredientRes.data ?? []) as RecipeIngredient[]).sort((a, b) => a.position - b.position)) {
      ingredientsByRecipe.set(ing.recipe_id, [...(ingredientsByRecipe.get(ing.recipe_id) ?? []), ing]);
    }
    missing = briefMissing({
      entries: (entryRes.data ?? []) as MealPlanEntry[],
      today,
      recipesById,
      ingredientsByRecipe,
      groceryItems: items,
      staples: stapleKeys((stapleRes.data ?? []) as RecipeStaple[]),
    });
  }
  return groceriesBrief({ items, today, missing });
}

/** Cost lines anyone keeps private stay out of a shared chat; the Money brief has no private rows of its own. */
async function money(ctx: HelperBriefContext): Promise<HelperBrief> {
  const { data } = await ctx.admin.from("cost_items").select("*").eq("group_id", ctx.groupId).eq("deleted", false);
  return moneyBrief({ items: (data ?? []) as CostItem[], today: todayIn(ctx.timeZone, ctx.now) });
}

async function week(ctx: HelperBriefContext): Promise<HelperBrief> {
  const { data } = await ctx.admin.from("household_tasks").select("*").eq("group_id", ctx.groupId).eq("deleted", false).eq("done", false);
  const visible = visibleTasks((data ?? []) as HouseholdTask[], ctx.userId);
  const tasks = ctx.shared ? visible.filter((t) => !t.private) : visible;
  return weekBrief({ tasks, today: todayIn(ctx.timeZone, ctx.now), me: ctx.userId });
}

async function dinners(ctx: HelperBriefContext): Promise<HelperBrief | null> {
  if (!ctx.enabled.has("meals" as ModuleId)) return null;
  const today = todayIn(ctx.timeZone, ctx.now);
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const [entryRes, recipeRes] = await Promise.all([
    ctx.admin.from("meal_plan_entries").select("*").eq("group_id", ctx.groupId).eq("deleted", false).gte("date", today).lte("date", last),
    ctx.admin.from("recipes").select("*").eq("group_id", ctx.groupId).eq("deleted", false),
  ]);
  return dinnersBrief({ entries: (entryRes.data ?? []) as MealPlanEntry[], recipes: (recipeRes.data ?? []) as Recipe[], today });
}

/** Occasions and ideas kept from this person (hidden_from) never count; the Gifts chat is never shared. */
async function gifts(ctx: HelperBriefContext): Promise<HelperBrief> {
  const [occRes, ideaRes] = await Promise.all([
    ctx.admin.from("occasions").select("*").eq("group_id", ctx.groupId).eq("deleted", false),
    ctx.admin.from("gift_ideas").select("*").eq("group_id", ctx.groupId).eq("deleted", false),
  ]);
  const seen = <T extends { hidden_from?: string[] | null }>(rows: T[]) => rows.filter((r) => !(r.hidden_from ?? []).includes(ctx.userId));
  return giftsBrief({
    occasions: seen((occRes.data ?? []) as Occasion[]),
    ideas: seen((ideaRes.data ?? []) as GiftIdea[]),
    today: todayIn(ctx.timeZone, ctx.now),
    me: ctx.userId,
  });
}

const BRIEFS: Partial<Record<string, (ctx: HelperBriefContext) => Promise<HelperBrief | null>>> = {
  groceries,
  costs: money,
  household: week,
  recipes: dinners,
  occasions: gifts,
};

/** The helper's brief, or null when it has none or the read fails (the chat goes on without it). */
export async function loadHelperBrief(helper: string, ctx: HelperBriefContext): Promise<HelperBrief | null> {
  const load = BRIEFS[helper];
  if (!load) return null;
  try {
    return await load(ctx);
  } catch (e) {
    console.error("[assistant] helper brief failed", helper, e);
    return null;
  }
}
