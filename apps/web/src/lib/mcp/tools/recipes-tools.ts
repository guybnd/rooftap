import { z } from "zod";
import {
  itemLink,
  allCookTimers,
  assistantTimer,
  buildCookSession,
  clampStep,
  cookTimers,
  recipeSteps,
  startTimer,
  stepIngredients,
  timerRemainingMs,
  timerState,
  type CookSession,
  aliasMap,
  isStaple,
  stapleKeys,
  type IngredientAlias,
  type RecipeStaple,
  buildNeededGroceryItem,
  groceryStatusPatch,
  ingredientMatchKey,
  matchIngredientToGrocery,
  norm,
  recipeCuisines,
  recipeNoteFor,
  stepsFromInstructions,
  type GroceryItem,
  type Recipe,
  type RecipeIngredient,
  buildRecipe,
  buildRecipeIngredient,
  instructionsFromSteps,
  type RecipeMethod,
} from "@homeup/core";
import { basic, fail, ok, toolRegistrar, type HouseholdTool, type HouseholdToolContext } from "../tool-kit";
import { type ToolData } from "../tool-data";

// Recipes and cooking: "what can I cook", saving a recipe, putting its
// ingredients on the list, and cook mode's steps and timers. A cook is the
// person's own (cook_sessions, tool-data.ts).

/**
 * Recipes scan match: the household's staples (never on the list) and the
 * names it taught the match step, so the tools agree with the app.
 */
export async function loadRecipeMatch(db: ToolData) {
  const [stapleRows, aliasRows] = await Promise.all([
    db.rows<RecipeStaple>("recipe_staples"),
    db.rows<IngredientAlias>("ingredient_aliases"),
  ]);
  return { staples: stapleKeys(stapleRows), aliases: aliasMap(aliasRows) };
}

export function recipesTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { userId, enabled, deviceId } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  const liveRecipe = (recipeId: string) => db.row<Recipe>("recipes", recipeId);
  const myCooks = () => db.rows<CookSession>("cook_sessions");

  tool(
    "get_recipes",
    {
      description:
        "The household's saved recipes. With no arguments, a short list (title, cuisines, method, times, ingredient names). Pass query to filter by a word in the title, a cuisine or an ingredient. Pass recipe_id for one recipe in full: ingredients with quantities, and the steps. to_try marks an idea on the To try list, not yet kept in the book.",
      inputSchema: {
        query: z.string().optional(),
        recipe_id: z.string().optional(),
      },
    },
    async ({ query, recipe_id }) => {
      const recipes = await db.rows<Recipe>("recipes", (q) =>
        recipe_id ? q.eq("draft", false).eq("id", recipe_id) : q.eq("draft", false),
      );
      if (recipe_id && recipes.length === 0) return fail("Recipe not found");
      const ids = recipes.map((r) => r.id);
      const ingredientRows = ids.length ? await db.rows<RecipeIngredient>("recipe_ingredients", (q) => q.in("recipe_id", ids)) : [];
      const byRecipe = new Map<string, RecipeIngredient[]>();
      for (const ing of ingredientRows.sort((a, b) => a.position - b.position)) {
        byRecipe.set(ing.recipe_id, [...(byRecipe.get(ing.recipe_id) ?? []), ing]);
      }
      if (recipe_id) {
        const recipe = recipes[0];
        const full = {
          ...basic(recipe, ["id", "title", "method", "servings", "prep_minutes", "cook_minutes", "source"] as const),
          cuisines: recipeCuisines(recipe),
          ingredients: (byRecipe.get(recipe.id) ?? []).map((i) => basic(i, ["name", "quantity", "unit"] as const)),
          steps: stepsFromInstructions(recipe.instructions),
          ...(recipe.to_try ? { to_try: true } : {}),
          link: itemLink("recipe", recipe.id),
        };
        return ok(full);
      }
      const q = norm(query);
      const rows = recipes
        .map((r) => ({
          ...basic(r, ["id", "title", "method", "servings", "prep_minutes", "cook_minutes"] as const),
          cuisines: recipeCuisines(r),
          ingredients: (byRecipe.get(r.id) ?? []).map((i) => i.name),
          ...(r.to_try ? { to_try: true } : {}),
          link: itemLink("recipe", r.id),
        }))
        .filter((r) => !q || [r.title ?? "", ...r.cuisines, ...r.ingredients].some((s) => norm(s).includes(q)))
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
      return ok(rows);
    },
  );

  tool(
    "save_recipe",
    {
      description:
        "Recipes: save a new recipe to the household's book, from what the person typed or pasted. ingredients each have the line as written (name, e.g. \"2 cups arborio rice\"), and when you can tell them, the plain grocery item (item, e.g. \"arborio rice\"), quantity and unit. steps are the method, one per entry. Check get_recipes first so you don't save the same one twice. to_try puts it on the To try list instead of the main book: use it when the person wants to try a recipe, calls it a suggestion or an idea, or hasn't cooked it yet; they keep it from the recipe's screen once they like it.",
      inputSchema: {
        title: z.string().min(1).max(200),
        ingredients: z
          .array(
            z.object({
              name: z.string().min(1).max(300),
              item: z.string().max(100).optional(),
              quantity: z.number().positive().optional(),
              unit: z.string().max(30).optional(),
            }),
          )
          .max(100),
        steps: z.array(z.string().min(1).max(2000)).max(100).optional(),
        servings: z.number().int().positive().max(100).optional(),
        prep_minutes: z.number().int().nonnegative().max(2880).optional(),
        cook_minutes: z.number().int().nonnegative().max(2880).optional(),
        cuisines: z.array(z.string().max(40)).max(8).optional(),
        method: z.enum(["cooking", "baking", "roasting", "other"]).optional(),
        source_url: z.string().url().optional(),
        to_try: z.boolean().optional(),
      },
    },
    async (args) => {
      const existing = await db.rows<Recipe>("recipes");
      const same = existing.find((r) => norm(r.title) === norm(args.title));
      if (same) return fail(`There's already a recipe called ${same.title} (id ${same.id}).`);
      const recipe = buildRecipe({
        groupId: groupId,
        title: args.title,
        cuisines: args.cuisines ?? [],
        method: (args.method ?? null) as RecipeMethod | null,
        instructions: instructionsFromSteps(args.steps ?? []),
        servings: args.servings ?? null,
        prepMinutes: args.prep_minutes ?? null,
        cookMinutes: args.cook_minutes ?? null,
        source: args.source_url ?? null,
        sourceType: args.source_url ? "url" : "manual",
        toTry: args.to_try,
        createdBy: userId,
      });
      await db.insert("recipes", recipe);
      const ingredients = args.ingredients.map((i, position) =>
        buildRecipeIngredient({
          recipeId: recipe.id,
          groupId: groupId,
          name: i.name,
          itemName: i.item ?? null,
          quantity: i.quantity ?? null,
          unit: i.unit ?? null,
          position,
        }),
      );
      if (ingredients.length) {
        await db.insert("recipe_ingredients", ingredients);
      }
      return ok({
        ok: true,
        id: recipe.id,
        title: recipe.title,
        ingredients: ingredients.length,
        ...(recipe.to_try ? { to_try: true } : {}),
        link: itemLink("recipe", recipe.id),
      });
    },
    null,
  );

  tool(
    "add_recipe_to_groceries",
    {
      description:
        "Put a recipe's ingredients on the grocery list. Ingredients already on the list as needed, or in stock (have or bought), are left alone unless include_stocked is true. Household staples (salt, oil and the like) never go on the list. The result says which were added and which were skipped.",
      inputSchema: {
        recipe_id: z.string(),
        include_stocked: z.boolean().optional(),
      },
    },
    async ({ recipe_id, include_stocked }) => {
      if (!enabled.has("groceries")) return fail("The Groceries module is off for this household");
      const recipe = await liveRecipe(recipe_id);
      if (!recipe) return fail("Recipe not found");
      const [ingredientRows, groceries, { staples, aliases }] = await Promise.all([
        db.rows<RecipeIngredient>("recipe_ingredients", (q) => q.eq("recipe_id", recipe_id)),
        db.rows<GroceryItem>("grocery_items"),
        loadRecipeMatch(db),
      ]);
      const ingredients = ingredientRows.sort((a, b) => a.position - b.position);
      const added: string[] = [];
      const skipped: { name: string; reason: string }[] = [];
      for (const ing of ingredients) {
        const own = ingredientMatchKey(ing);
        if (isStaple(own, staples) || isStaple(ing.name, staples)) {
          skipped.push({ name: own, reason: "staple" });
          continue;
        }
        // A name the household taught ("arborio rice" is our "Risotto rice").
        const key = aliases.get(norm(own)) ?? own;
        const match = matchIngredientToGrocery(key, groceries);
        if (match?.status === "needed") {
          skipped.push({ name: key, reason: "already on the list" });
          continue;
        }
        if (match && !include_stocked) {
          skipped.push({ name: key, reason: "in stock" });
          continue;
        }
        const note = recipeNoteFor(ing, recipe.title);
        if (match)
          await db.update("grocery_items", match.id, {
            ...groceryStatusPatch("needed"),
            recipe_note: note,
            recipe_source_id: recipe.id,
            updated_by: userId,
          });
        else
          await db.insert(
            "grocery_items",
            buildNeededGroceryItem({
              groupId,
              name: key,
              recipeNote: note,
              recipeSourceId: recipe.id,
              createdBy: userId,
              quantity: ing.quantity,
              unit: ing.unit,
            }),
          );
        added.push(key);
      }
      return ok({ recipe: recipe.title, added, skipped });
    },
    null,
  );

  tool(
    "get_recipe_steps",
    {
      description:
        "One recipe's method as numbered steps (1-based), each with its timers (label, minutes) and the ingredients it uses, plus the step the person is on if they are cooking it. Use before start_timer, or to answer \"what's next\".",
      inputSchema: { recipe_id: z.string() },
    },
    async ({ recipe_id }) => {
      const recipe = await liveRecipe(recipe_id);
      if (!recipe) return fail("Recipe not found");
      const [ingredients, cooks] = await Promise.all([
        db.rows<RecipeIngredient>("recipe_ingredients", (q) => q.eq("recipe_id", recipe.id)),
        myCooks(),
      ]);
      const steps = recipeSteps(recipe);
      const cook = cooks.find((c) => c.recipe_id === recipe.id);
      return ok({
        recipe_id: recipe.id,
        title: recipe.title,
        servings: recipe.servings,
        ...(cook ? { cooking_step: clampStep(cook.step, steps.length) + 1 } : {}),
        steps: steps.map((st, i) => ({
          step: i + 1,
          text: st.text,
          timers: st.timers.map((t) => ({ label: t.label, minutes: Math.round((t.seconds / 60) * 10) / 10 })),
          ingredients: stepIngredients(st, ingredients).map((ing) => basic(ing, ["name", "quantity", "unit"] as const)),
        })),
      });
    },
    null,
  );

  tool(
    "get_running_cooks",
    {
      description:
        "The recipes the person is cooking right now: each with the step they are on (1-based) and its timers (label, step, state running/paused/done, seconds_left).",
    },
    async () => {
      const cooks = await myCooks();
      const ids = [...new Set(cooks.map((c) => c.recipe_id))];
      const recipeRows = ids.length ? await db.rows<Recipe>("recipes", (q) => q.in("id", ids)) : [];
      const recipes = new Map(recipeRows.map((r) => [r.id, r]));
      const now = Date.now();
      const out = cooks
        .filter((c) => recipes.has(c.recipe_id))
        .map((c) => {
          const recipe = recipes.get(c.recipe_id)!;
          const steps = recipeSteps(recipe);
          return {
            cook_id: c.id,
            recipe_id: recipe.id,
            title: recipe.title,
            step: clampStep(c.step, steps.length) + 1,
            steps: steps.length,
            timers: cookTimers(c).map((t) => ({
              label: t.label,
              step: t.step + 1,
              state: timerState(t, now),
              seconds_left: Math.round(timerRemainingMs(t, now) / 1000),
            })),
          };
        });
      return ok(out);
    },
    null,
  );

  tool(
    "start_timer",
    {
      description:
        "Start a cooking timer on a recipe the person is cooking (it starts cooking the recipe if needed). Pass step (1-based, defaults to the step they are on), and label and/or minutes: a step's own timer is used when the label or minutes match one, else a new timer is added. It rings on the device they asked from, or the one they last started a timer on (rings false: it only shows in the app).",
      inputSchema: {
        recipe_id: z.string(),
        step: z.number().int().min(1).optional(),
        label: z.string().max(40).optional(),
        minutes: z
          .number()
          .positive()
          .max(24 * 60)
          .optional(),
      },
    },
    async ({ recipe_id, step, label, minutes }) => {
      if (!enabled.has("recipes")) return fail("The Recipes module is off for this household");
      const recipe = await liveRecipe(recipe_id);
      if (!recipe) return fail("Recipe not found");
      const cooks = await myCooks();
      const steps = recipeSteps(recipe);
      const existing = cooks.find((c) => c.recipe_id === recipe.id) ?? null;
      const stepIndex = clampStep(step != null ? step - 1 : (existing?.step ?? 0), steps.length);
      const timers = existing ? allCookTimers(existing) : [];
      const pick = assistantTimer(steps[stepIndex], stepIndex, timers, { label, minutes });
      if (!pick) return fail("Say how many minutes: this step has no timer of its own");
      // Rings on the asking device, else on the device the person last started a timer from.
      const startedAt = (t: { endsAt: string | null; seconds: number }) => (t.endsAt ? Date.parse(t.endsAt) - t.seconds * 1000 : 0);
      const lastDevice = cooks
        .flatMap((c) => cookTimers(c))
        .filter((t) => t.deviceId)
        .sort((a, b) => startedAt(b) - startedAt(a))[0]?.deviceId;
      const ringOn = deviceId ?? lastDevice ?? null;
      const next = startTimer(timers, pick, ringOn, Date.now());
      if (existing) await db.update("cook_sessions", existing.id, { timers: next });
      else
        await db.insert("cook_sessions", { ...buildCookSession({ groupId, userId, recipeId: recipe.id }), step: stepIndex, timers: next });
      return ok({
        ok: true,
        recipe: recipe.title,
        step: pick.step + 1,
        label: pick.label,
        minutes: Math.round((pick.seconds / 60) * 10) / 10,
        rings: Boolean(ringOn),
      });
    },
    null,
  );

  return tools;
}
