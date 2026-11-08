// The Dinners helper's brief (module-helpers.ts): the week's nights from
// tonight, what is planned and which nights are still open, with no AI. The
// helper lives on Recipes (the meal plan is its "This week" tab), so its
// rows open there. The same function runs on the device and on the server.

import type { Recipe } from '../../types';
import { addDaysISO } from '../../date-utils';
import type { BriefRow, HelperBrief } from '../../module-helpers';
import { nightName } from '../groceries/helper-brief';
import { WEEK_NIGHTS, dishesTitle, mealDishesByDate, type MealPlanEntry } from './meal-plan';

export function dinnersBrief(input: { entries: readonly MealPlanEntry[]; recipes: readonly Recipe[]; today: string }): HelperBrief {
  const recipesById = new Map(input.recipes.filter((r) => r && !r.deleted).map((r) => [r.id, r]));
  const byDate = mealDishesByDate(input.entries);
  const rows: BriefRow[] = [];
  const open: string[] = [];
  for (let i = 0; i < WEEK_NIGHTS; i++) {
    const date = addDaysISO(input.today, i);
    const dishes = byDate.get(date) ?? [];
    const title = dishesTitle(dishes, recipesById) ?? (dishes.find((d) => !d.recipe_id)?.label?.trim() || null);
    const night = nightName(date, input.today);
    if (!title) open.push(night);
    rows.push({ kind: 'item', id: `night:${date}`, title: night, meta: title ?? 'Nothing planned', warn: !title && i === 0, href: '/recipes?tab=week' });
  }
  const planned = WEEK_NIGHTS - open.length;
  const lede =
    open.length === 0
      ? 'Every night this week has a dinner.'
      : open.length === WEEK_NIGHTS
        ? 'Nothing planned yet for the next seven nights.'
        : `${planned} of the next seven nights planned. Still open: ${open.slice(0, 3).join(', ')}${open.length > 3 ? ` and ${open.length - 3} more` : ''}.`;
  const title = open[0] === 'Tonight' ? "What's for dinner tonight?" : open.length ? 'Plan the open nights' : 'The week is planned';
  return { title, lede, sections: [{ id: 'nights', title: 'The next seven nights', rows }] };
}
