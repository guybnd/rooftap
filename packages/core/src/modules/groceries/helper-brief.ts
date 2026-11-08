// The Groceries helper's brief (module-helpers.ts): what the shop needs today,
// from the household's own rows, with no AI. The same function runs on the
// device (the chat's opening rows) and on the server (the prompt), so both
// say the same thing.

import type { GroceryItem, Recipe, RecipeIngredient } from '../../types';
import { addDaysISO, daysBetweenISO } from '../../date-utils';
import { weekShopping, type MealPlanEntry } from '../meals/meal-plan';
import type { BriefRow, BriefSection, HelperBrief } from '../../module-helpers';
import { countNeeded, freshnessWindow, suggestReAdd } from './groceries';
import { resolveItemDefaults, type LibraryOverride } from './item-library';

/** An ingredient a planned dinner needs that is not on the list or in stock. */
export interface BriefMissing {
  /** The name the list matches on, which becomes the item's name. */
  key: string;
  recipeId: string;
  recipeTitle: string;
  /** The first night it is cooked, as a weekday ("Tuesday"); null when unknown. */
  night: string | null;
}

export interface GroceriesBriefInput {
  /** The list's rows the person can see (not deleted). */
  items: readonly GroceryItem[];
  library?: Map<string, LibraryOverride>;
  /** YYYY-MM-DD, in the household's zone. */
  today: string;
  /** What the week's planned dinners still need; null while Meals is off or not linked. */
  missing?: readonly BriefMissing[] | null;
}

/** At most this many rows per section; the helper can list the rest when asked. */
export const BRIEF_ROWS = 6;

function daysAgo(iso: string | null, today: string): string | null {
  if (typeof iso !== 'string' || !iso) return null;
  const days = daysBetweenISO(iso.slice(0, 10), today);
  if (!(days >= 0)) return null;
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}

function keepsFor(days: number | null): string | null {
  if (days == null || !(days > 0)) return null;
  if (days < 14) return `Keeps about ${days} days`;
  if (days < 45) return `Keeps about ${Math.round(days / 7)} weeks`;
  return `Keeps about ${Math.round(days / 30)} months`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function groceriesBrief(input: GroceriesBriefInput): HelperBrief {
  const items = input.items.filter((i) => i && !i.deleted && typeof i.name === 'string');
  const needed = countNeeded(items as GroceryItem[]);

  // For this week's dinners: one row per missing ingredient, earliest night first.
  const missing = input.missing ?? [];
  const dinners: BriefRow[] = missing.slice(0, BRIEF_ROWS).map((m) => ({
    kind: 'suggest',
    key: m.key,
    title: m.key.charAt(0).toUpperCase() + m.key.slice(1),
    meta: m.night ? `${m.recipeTitle}, ${m.night}` : m.recipeTitle,
  }));

  // Running low or past it: the list's own re-add suggestions (got it, shelf life passed).
  const low = suggestReAdd(items as GroceryItem[], input.library, input.today);
  const usuals: BriefRow[] = low.slice(0, BRIEF_ROWS).map((i) => {
    const days = typeof i.shelf_life_days === 'number' ? i.shelf_life_days : resolveItemDefaults(i.name, input.library).days;
    return {
      kind: 'item',
      id: i.id,
      title: i.name,
      meta: keepsFor(days),
      trailing: daysAgo(i.status_changed_at, input.today),
      action: 'readd',
    };
  });
  const lowIds = new Set(low.map((i) => i.id));

  // Use soon: in stock, with a day or two left.
  const soon: BriefRow[] = [];
  for (const i of items) {
    if (i.status === 'needed' || lowIds.has(i.id)) continue;
    let left: number | null = null;
    if (i.expiry_date) left = daysBetweenISO(input.today, i.expiry_date.slice(0, 10));
    else {
      const days = typeof i.shelf_life_days === 'number' ? i.shelf_life_days : resolveItemDefaults(i.name, input.library).days;
      left = freshnessWindow(i.status_changed_at, days, input.today)?.remainingDays ?? null;
    }
    if (left == null || left < 0 || left > 2) continue;
    soon.push({ kind: 'item', id: i.id, title: i.name, meta: i.aisle || null, trailing: left === 0 ? 'Use today' : left === 1 ? 'Use by tomorrow' : 'Use in 2 days', warn: left === 0 });
  }
  soon.sort((a, b) => (a.kind === 'item' && b.kind === 'item' ? Number(!!b.warn) - Number(!!a.warn) : 0));

  const sections: BriefSection[] = [];
  if (dinners.length) sections.push({ id: 'dinners', title: "For this week's dinners", rows: dinners, allLabel: dinners.length > 1 ? 'Add all' : null });
  if (usuals.length) sections.push({ id: 'usuals', title: 'Running low or past it', rows: usuals, allLabel: usuals.length > 1 ? 'Re-add all' : null });
  if (soon.length) sections.push({ id: 'soon', title: 'Use soon', rows: soon.slice(0, BRIEF_ROWS) });

  const said: string[] = [];
  if (missing.length) {
    const nights = [...new Set(missing.map((m) => m.recipeTitle))];
    said.push(nights.length === 1 ? `${nights[0]} still needs ${count(missing.length, 'thing', 'things')}` : `This week's dinners still need ${count(missing.length, 'thing', 'things')}`);
  }
  if (low.length) said.push(`${count(low.length, 'thing', 'things')} may be running low`);
  const lede =
    (needed > 0 ? `${count(needed, 'thing', 'things')} on the list.` : 'Nothing on the list yet.') +
    (said.length ? ` ${said.join(', and ').replace(/^./, (c) => c.toUpperCase())}.` : '');
  const title = needed > 0 ? 'Ready for the shop' : sections.length ? 'Time to plan the shop' : 'All sorted';
  return { title, lede, sections };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Tonight", "Tomorrow" or the weekday of a YYYY-MM-DD night. */
export function nightName(date: string, today: string): string {
  if (date === today) return 'Tonight';
  if (date === addDaysISO(today, 1)) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * What the planned dinners from `today` through the next six nights still
 * need, each with its recipe and first night (core weekShopping).
 */
export function briefMissing(input: {
  entries: readonly MealPlanEntry[];
  today: string;
  recipesById: ReadonlyMap<string, Recipe>;
  ingredientsByRecipe: ReadonlyMap<string, readonly RecipeIngredient[]>;
  groceryItems: readonly GroceryItem[];
  staples?: ReadonlySet<string>;
}): (BriefMissing & { ingredient: RecipeIngredient })[] {
  const last = addDaysISO(input.today, 6);
  const week = input.entries.filter((e) => !e.deleted && e.recipe_id && e.date >= input.today && e.date <= last);
  const firstNight = new Map<string, string>();
  for (const e of [...week].sort((a, b) => a.date.localeCompare(b.date))) if (!firstNight.has(e.recipe_id!)) firstNight.set(e.recipe_id!, e.date);
  const { missing } = weekShopping({
    entries: week,
    fromDate: input.today,
    recipesById: input.recipesById,
    ingredientsByRecipe: input.ingredientsByRecipe,
    groceryItems: input.groceryItems,
    staples: input.staples,
  });
  return missing.map((m) => {
    const night = firstNight.get(m.recipe.id);
    return { key: m.key, recipeId: m.recipe.id, recipeTitle: m.recipe.title, night: night ? nightName(night, input.today) : null, ingredient: m.ingredient };
  });
}
