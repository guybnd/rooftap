// Meal plan: the week's dinners, planned in Recipes' "This week" tab (the
// `meals` module, which requires Recipes). One `meal_plan_entries` row per
// night: a recipe, or a label for a night without one (Out, Leftovers, free
// text), and who cooks. Pure derivations so web, the app, the Home row, the
// assistant tools and the draft route all read a week the same way.

import { envRandomUUID } from '../../data/store-environment';
import { addDaysISO, daysBetweenISO, formatTime12h, toISODate } from '../../date-utils';
import { freshnessWindow } from '../groceries/groceries';
import { ingredientMatchKey, matchIngredientToGrocery, norm } from '../recipes/recipes';
import { lookupDefaultShelfLife } from '../groceries/shelf-life-defaults';
import type { GroceryItem, Recipe, RecipeIngredient } from '../../types';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

export interface MealPlanEntry {
  id: string;
  group_id: string;
  /** The night, YYYY-MM-DD. */
  date: string;
  slot: MealSlot;
  recipe_id: string | null;
  /** A night without a recipe: "Out", "Leftovers" or free text. Ignored while recipe_id is set. */
  label: string | null;
  cook_user_id: string | null;
  note: string | null;
  // NOT NULL-free in the DB; writeRow stamps the active user.
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

/** The quick picks for a night without a recipe. */
export const MEAL_QUICK_LABELS = ['Leftovers', 'Out'] as const;

export const WEEK_NIGHTS = 7;

/** The Monday on or before `dateISO`: the first night of its week. */
export function mealWeekStart(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  return addDaysISO(dateISO, -((weekday + 6) % 7));
}

/** The week's seven nights from its Monday, YYYY-MM-DD. */
export function mealWeekDates(weekStart: string): string[] {
  return Array.from({ length: WEEK_NIGHTS }, (_, i) => addDaysISO(weekStart, i));
}

function parseISO(dateISO: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "Mon 27": a night's row label. */
export function mealNightLabel(dateISO: string): { weekday: string; day: string } {
  const date = parseISO(dateISO);
  return { weekday: date.toLocaleDateString('en-US', { weekday: 'short' }), day: String(date.getDate()) };
}

/** "Mon 27 Oct to Sun 2 Nov": the week's caption. */
export function mealWeekRangeLabel(weekStart: string): string {
  const fmt = (iso: string) => {
    const d = parseISO(iso);
    return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}`;
  };
  return `${fmt(weekStart)} to ${fmt(addDaysISO(weekStart, WEEK_NIGHTS - 1))}`;
}

/** "This week", "Next week", "Last week", else the range. */
export function mealWeekName(weekStart: string, todayISO: string): string {
  const diff = daysBetweenISO(mealWeekStart(todayISO), weekStart) / WEEK_NIGHTS;
  if (diff === 0) return 'This week';
  if (diff === 1) return 'Next week';
  if (diff === -1) return 'Last week';
  return mealWeekRangeLabel(weekStart);
}

/**
 * One entry per night for `slot`: the newest live row wins. Two people can
 * plan the same night offline, so the table has no unique key and the latest
 * edit is the one shown.
 */
export function mealEntriesByDate(
  entries: readonly MealPlanEntry[],
  slot: MealSlot = 'dinner',
): Map<string, MealPlanEntry> {
  const out = new Map<string, MealPlanEntry>();
  for (const e of entries) {
    if (!e || e.deleted || (e.slot ?? 'dinner') !== slot) continue;
    const prev = out.get(e.date);
    if (!prev || (e.updated_at ?? '') > (prev.updated_at ?? '')) out.set(e.date, e);
  }
  return out;
}

/** Older rows for the same night, which a write should tidy away. */
export function shadowedMealEntries(entries: readonly MealPlanEntry[], date: string, slot: MealSlot = 'dinner'): MealPlanEntry[] {
  const winner = mealEntriesByDate(entries, slot).get(date);
  return entries.filter((e) => e && !e.deleted && e.date === date && (e.slot ?? 'dinner') === slot && e.id !== winner?.id);
}

/** Whether a night has something on it (a recipe or a label). */
export function isNightPlanned(entry: MealPlanEntry | null | undefined, recipesById?: ReadonlyMap<string, Recipe>): boolean {
  if (!entry || entry.deleted) return false;
  if (entry.recipe_id) return !recipesById || recipesById.has(entry.recipe_id);
  return !!entry.label?.trim();
}

/** What a night says: the recipe's title, else its label, else null. */
export function mealTitle(entry: MealPlanEntry | null | undefined, recipesById: ReadonlyMap<string, Recipe>): string | null {
  if (!entry || entry.deleted) return null;
  if (entry.recipe_id) return recipesById.get(entry.recipe_id)?.title ?? null;
  return entry.label?.trim() || null;
}

/** Prep plus cook time, null when neither is known. */
export function recipeMinutes(recipe: Pick<Recipe, 'prep_minutes' | 'cook_minutes'> | null | undefined): number | null {
  if (!recipe) return null;
  const total = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0);
  return total > 0 ? total : null;
}

/** "35 min", "1 h", "1 h 10 min". */
export function formatMealMinutes(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** A recipe counts as quick for a busy night at 30 minutes or less. */
export const QUICK_MEAL_MINUTES = 30;

export function buildMealPlanEntry(input: {
  groupId: string;
  date: string;
  slot?: MealSlot;
  recipeId?: string | null;
  label?: string | null;
  cookUserId?: string | null;
  note?: string | null;
  createdBy: string | null;
}): MealPlanEntry {
  const now = new Date().toISOString();
  return {
    id: envRandomUUID(),
    group_id: input.groupId,
    date: input.date,
    slot: input.slot ?? 'dinner',
    recipe_id: input.recipeId ?? null,
    label: input.recipeId ? null : input.label?.trim() || null,
    cook_user_id: input.cookUserId ?? null,
    note: input.note ?? null,
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

// ── Missing ingredients ─────────────────────────────────────────────────────

export interface MissingIngredient {
  /** The key the grocery list matches on (item_name ?? name). */
  key: string;
  ingredient: RecipeIngredient;
  recipe: Recipe;
}

export interface WeekShopping {
  /** Not on the list and not in stock, once each. */
  missing: MissingIngredient[];
  /** Already on the list as needed. */
  onList: number;
}

/**
 * What the planned recipes from `fromDate` on still need, compared with the
 * grocery list the same way "Add missing" on a recipe does: an ingredient on
 * the list as needed counts as on the list, one in stock (have or bought) is
 * left alone, anything else is missing. Each ingredient counts once, however
 * many nights use it.
 */
export function weekShopping(input: {
  entries: Iterable<MealPlanEntry>;
  fromDate: string;
  recipesById: ReadonlyMap<string, Recipe>;
  ingredientsByRecipe: ReadonlyMap<string, readonly RecipeIngredient[]>;
  groceryItems: readonly GroceryItem[];
}): WeekShopping {
  const seen = new Set<string>();
  const missing: MissingIngredient[] = [];
  let onList = 0;
  const entries = [...input.entries].filter((e) => !e.deleted && e.date >= input.fromDate && e.recipe_id).sort((a, b) => a.date.localeCompare(b.date));
  for (const entry of entries) {
    const recipe = input.recipesById.get(entry.recipe_id!);
    if (!recipe) continue;
    for (const ing of input.ingredientsByRecipe.get(recipe.id) ?? []) {
      if (ing.deleted) continue;
      const key = ingredientMatchKey(ing);
      const n = norm(key);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      const match = matchIngredientToGrocery(key, input.groceryItems as GroceryItem[]);
      if (match?.status === 'needed') onList++;
      else if (!match) missing.push({ key, ingredient: ing, recipe });
    }
  }
  return { missing, onList };
}

// ── Calendar hints ──────────────────────────────────────────────────────────

/** A dated thing from the calendar, reduced to what the plan needs. */
export interface MealAgendaItem {
  title: string;
  date: string;
  /** HH:MM, null for all day. */
  time: string | null;
}

/** Evening plans start between 4 pm and 9 pm. */
function isEvening(time: string | null): boolean {
  return !!time && time >= '16:00' && time < '21:00';
}

/** The first evening plan on a night, if any. */
export function busyEvening(date: string, agenda: readonly MealAgendaItem[]): MealAgendaItem | null {
  return (
    agenda
      .filter((a) => a.date === date && isEvening(a.time))
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))[0] ?? null
  );
}

/**
 * A night's caption hint from the calendar: "Viewing at 6:30 PM, try
 * something quick" on a busy evening, "Free all day" on an empty night with
 * nothing on. Never edits the plan.
 */
export function mealNightHint(date: string, agenda: readonly MealAgendaItem[], planned: boolean): string | null {
  const busy = busyEvening(date, agenda);
  if (busy) return `${busy.title} at ${formatTime12h(busy.time)}${planned ? '' : ', try something quick'}`;
  if (!planned && !agenda.some((a) => a.date === date)) return 'Free all day';
  return null;
}

/** An instant's wall-clock date and time, in `timeZone` (an IANA name) or the device's own zone. */
export function localDateTime(iso: string, timeZone?: string): { date: string; time: string } {
  const d = new Date(iso);
  if (!timeZone) {
    return { date: toISODate(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Calendar events as agenda items, in `timeZone` (server) or the device's zone (apps). */
export function agendaFromEvents(
  events: readonly { title: string; starts_at: string; is_all_day: boolean; deleted?: boolean }[],
  timeZone?: string,
): MealAgendaItem[] {
  return events
    .filter((e) => !e.deleted && e.starts_at)
    .map((e) => {
      if (e.is_all_day) return { title: e.title, date: e.starts_at.slice(0, 10), time: null };
      const { date, time } = localDateTime(e.starts_at, timeZone);
      return { title: e.title, date, time };
    });
}

// ── Groceries going off ─────────────────────────────────────────────────────

export interface GoingOff {
  name: string;
  /** Days left, 0 = today. */
  daysLeft: number;
}

/**
 * Things in stock that go off within `withinDays`: an expiry date when the
 * item has one, else its shelf life from when it was got.
 */
export function groceriesGoingOff(items: readonly GroceryItem[], todayISO: string, withinDays = 7): GoingOff[] {
  const out: GoingOff[] = [];
  for (const item of items) {
    if (item.deleted || item.status === 'needed') continue;
    let daysLeft: number | null = null;
    if (item.expiry_date) daysLeft = daysBetweenISO(todayISO, item.expiry_date.slice(0, 10));
    else {
      const days = item.shelf_life_days ?? lookupDefaultShelfLife(item.name);
      const fresh = freshnessWindow(item.status_changed_at, days, todayISO);
      if (fresh) daysLeft = fresh.remainingDays;
    }
    if (daysLeft != null && daysLeft >= 0 && daysLeft <= withinDays) out.push({ name: item.name, daysLeft });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ── Home ────────────────────────────────────────────────────────────────────

/** Home's row: "Tonight: Thai green curry", with "35 min" as its fact. Null when tonight isn't planned. */
export function tonightLine(
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  todayISO: string,
): { title: string; time: string | null; entry: MealPlanEntry } | null {
  const entry = mealEntriesByDate(entries).get(todayISO);
  const title = mealTitle(entry, recipesById);
  if (!entry || !title) return null;
  const recipe = entry.recipe_id ? recipesById.get(entry.recipe_id) : undefined;
  return { title: `Tonight: ${title}`, time: formatMealMinutes(recipeMinutes(recipe)), entry };
}

// ── Draft my week ───────────────────────────────────────────────────────────

/** One drafted night, as the draft route returns it. */
export interface MealDraftNight {
  date: string;
  recipe_id: string | null;
  label: string | null;
  /** Why this night: "Uses the spinach, off Wed", "Viewing at 6:30 PM". */
  reason: string | null;
}

export interface MealDraftRequest {
  /** The nights to fill, YYYY-MM-DD. */
  dates: string[];
  recipes: { id: string; title: string; minutes: number | null; cuisines: string[]; ingredients: string[] }[];
  /** Nights already planned around the empty ones, for variety. */
  planned: { date: string; title: string }[];
  busy: MealAgendaItem[];
  goingOff: GoingOff[];
}

export const MEAL_DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    nights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'The night, YYYY-MM-DD, one of the dates asked for' },
          recipe_id: { type: ['string', 'null'], description: "A recipe id from the household's list, or null" },
          label: { type: ['string', 'null'], description: 'Only when recipe_id is null: Leftovers or Out' },
          reason: { type: ['string', 'null'], description: 'Under 8 words, why this night' },
        },
        required: ['date', 'recipe_id', 'label', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['nights'],
  additionalProperties: false,
} as const;

export const MEAL_DRAFT_SYSTEM_PROMPT = `You plan a household's dinners for the week from their own saved recipes.
Rules:
- Fill each date you are given with exactly one night. Use only recipe ids from the list.
- Prefer recipes that use the groceries that go off soonest, on the earliest nights.
- On a busy evening, pick a quick recipe (30 minutes or less) or Leftovers.
- After a big recipe, a Leftovers night the next day is fine. Use Out only on a busy evening with no quick recipe.
- Vary cuisines and do not repeat a recipe in the week, unless there are fewer recipes than nights.
- reason is a short plain fragment, under 8 words, no emoji, no dashes. Examples: "Uses the spinach", "Viewing at 6:30 PM", "Quick weeknight".`;

/** The draft request's user message. */
export function mealDraftPrompt(req: MealDraftRequest): string {
  const lines: string[] = [];
  lines.push(`Dates to fill: ${req.dates.map((d) => `${d} (${parseISO(d).toLocaleDateString('en-US', { weekday: 'short' })})`).join(', ')}`);
  if (req.planned.length) lines.push(`Already planned: ${req.planned.map((p) => `${p.date} ${p.title}`).join('; ')}`);
  if (req.busy.length) lines.push(`Busy evenings: ${req.busy.map((b) => `${b.date} ${b.title} at ${b.time}`).join('; ')}`);
  if (req.goingOff.length) {
    lines.push(`Goes off soon: ${req.goingOff.map((g) => `${g.name} (${g.daysLeft === 0 ? 'today' : `${g.daysLeft} days`})`).join(', ')}`);
  }
  lines.push('Recipes (id | title | minutes | cuisines | ingredients):');
  for (const r of req.recipes) {
    lines.push(`${r.id} | ${r.title} | ${r.minutes ?? '?'} | ${r.cuisines.join(', ')} | ${r.ingredients.slice(0, 15).join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * The model's answer, checked: one night per asked date, real recipe ids
 * only, a label only without a recipe. Dates the model skipped come back
 * empty, so the person still sees every night.
 */
export function cleanMealDraft(raw: unknown, dates: readonly string[], recipeIds: ReadonlySet<string>): MealDraftNight[] {
  const nights = raw && typeof raw === 'object' && Array.isArray((raw as { nights?: unknown }).nights) ? ((raw as { nights: unknown[] }).nights) : [];
  const byDate = new Map<string, MealDraftNight>();
  for (const n of nights) {
    if (!n || typeof n !== 'object') continue;
    const o = n as Record<string, unknown>;
    const date = typeof o.date === 'string' ? o.date : '';
    if (!dates.includes(date) || byDate.has(date)) continue;
    const recipeId = typeof o.recipe_id === 'string' && recipeIds.has(o.recipe_id) ? o.recipe_id : null;
    const label = recipeId ? null : typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 60) : null;
    const reason = typeof o.reason === 'string' && o.reason.trim() ? o.reason.replace(/\s*[–—]\s*/g, ', ').trim().slice(0, 80) : null;
    byDate.set(date, { date, recipe_id: recipeId, label, reason });
  }
  return dates.map((date) => byDate.get(date) ?? { date, recipe_id: null, label: null, reason: null });
}

/** The nights a draft fills: unplanned nights from today to the week's end. */
export function draftableNights(
  weekDates: readonly string[],
  byDate: ReadonlyMap<string, MealPlanEntry>,
  recipesById: ReadonlyMap<string, Recipe>,
  todayISO: string,
): string[] {
  return weekDates.filter((d) => d >= todayISO && !isNightPlanned(byDate.get(d), recipesById));
}

/** The draft route's path; each app calls it with its own authed fetch. */
export const MEAL_DRAFT_PATH = '/api/meal-plan/draft';

/**
 * Asks the server to draft the week's empty nights. `send` is the app's own
 * fetch (cookies on web, a Bearer token on the phone). Throws with the
 * server's message (no AI key, nothing to plan with) for the app to show.
 */
export async function requestMealDraft(
  send: (path: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
  weekStart: string,
): Promise<MealDraftNight[]> {
  const res = await send(MEAL_DRAFT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekStart }),
  });
  const body = (await res.json().catch(() => ({}))) as { nights?: MealDraftNight[]; error?: string };
  if (!res.ok) throw new Error(body.error || 'Could not draft the week.');
  return Array.isArray(body.nights) ? body.nights : [];
}

/** "Guy": a cook's first name for a night's meta line, from the household's member profiles. */
export function cookName(
  userId: string | null | undefined,
  profiles: Readonly<Record<string, { email: string; name: string | null } | undefined>>,
): string | null {
  if (!userId) return null;
  const p = profiles[userId];
  if (!p) return null;
  return (p.name?.trim().split(/\s+/)[0] || p.email.split('@')[0] || null);
}
