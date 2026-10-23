import { NextResponse } from "next/server";
import {
  MEAL_DRAFT_SCHEMA,
  MEAL_DRAFT_SYSTEM_PROMPT,
  busyEvening,
  cleanMealDraft,
  draftableNights,
  groceriesGoingOff,
  mealDraftPrompt,
  mealEntriesByDate,
  mealTitle,
  mealWeekStart,
  recipeCuisines,
  recipeMinutes,
} from "@homeup/core";
import { AiBlockedError, aiBlockedResponse, recordAiRead, resolveAiKey, type ResolvedAiKey } from "@/lib/ai/access";
import { runStructuredParse } from "@/lib/ai/providers";
import { loadMealWeek, personTimeZone, todayIn } from "@/lib/meal-plan-server";
import { resolveGroupId } from "@/lib/pat";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { getEnabledModules, requireModules } from "@/lib/server-modules";

// Draft my week (Recipes > This week): the assistant's model plans the empty
// nights from the household's own recipes, around what goes off soon in
// Groceries and busy evenings in Calendar. Nothing is written here: the app
// shows the draft, the person keeps or swaps each night, and Keep writes the
// nights through the synced store. Gated like the other AI reads (the
// household's own key, or the server's within its plan).
export const maxDuration = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const off = await requireModules(user.id, "recipes", "meals", "assistant");
  if (off) return off;

  const body = (await request.json().catch(() => ({}))) as { weekStart?: unknown };
  const admin = createAdminClient();
  const groupId = await resolveGroupId(admin, user.id);
  if (!groupId) return NextResponse.json({ error: "No household" }, { status: 400 });

  const timeZone = await personTimeZone(admin, user.id);
  const today = todayIn(timeZone);
  const weekStart = typeof body.weekStart === "string" && ISO_DATE.test(body.weekStart) ? mealWeekStart(body.weekStart) : mealWeekStart(today);

  const enabled = await getEnabledModules(admin, groupId);
  const week = await loadMealWeek(admin, { userId: user.id, groupId, weekStart, timeZone, enabled });
  const byDate = mealEntriesByDate(week.entries);
  const dates = draftableNights(week.weekDates, byDate, week.recipesById, today);
  if (dates.length === 0) return NextResponse.json({ nights: [] });
  if (week.recipes.length === 0) {
    return NextResponse.json({ error: "Add a few recipes first, then the assistant can plan with them." }, { status: 422 });
  }

  let aiKey: ResolvedAiKey;
  try {
    aiKey = await resolveAiKey(user.id, "recipe", admin);
  } catch (e) {
    if (e instanceof AiBlockedError) return aiBlockedResponse(e);
    throw e;
  }

  const userText = mealDraftPrompt({
    dates,
    recipes: week.recipes.map((r) => ({
      id: r.id,
      title: r.title,
      minutes: recipeMinutes(r),
      cuisines: recipeCuisines(r),
      ingredients: (week.ingredientsByRecipe.get(r.id) ?? []).map((i) => i.item_name ?? i.name),
    })),
    planned: week.weekDates.flatMap((d) => {
      const title = mealTitle(byDate.get(d), week.recipesById);
      return title ? [{ date: d, title }] : [];
    }),
    busy: dates.flatMap((d) => {
      const busy = busyEvening(d, week.agenda);
      return busy ? [busy] : [];
    }),
    goingOff: groceriesGoingOff(week.groceryItems, today).slice(0, 12),
  });

  try {
    const raw = await runStructuredParse(
      aiKey.provider,
      { systemPrompt: MEAL_DRAFT_SYSTEM_PROMPT, userText, schema: MEAL_DRAFT_SCHEMA as unknown as Record<string, unknown>, schemaName: "meal_plan_draft" },
      aiKey.apiKey,
      aiKey.model,
    );
    await recordAiRead(aiKey, admin);
    return NextResponse.json({ weekStart, nights: cleanMealDraft(raw, dates, new Set(week.recipesById.keys())) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Draft failed";
    return NextResponse.json({ error: `Could not draft the week: ${message}` }, { status: 502 });
  }
}
