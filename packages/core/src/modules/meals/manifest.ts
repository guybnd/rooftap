import { defineModule } from '../../module-manifest';

export const mealsModule = defineModule({
  id: 'meals',
  label: 'Meal plan',
  description: 'Plan the week\'s dinners from your recipes, and add what\'s missing to Groceries.',
  iconId: 'utensils',
  // A tab inside Recipes ("This week"), not a section of its own. Like
  // Money insights it needs no switch of its own to lock Recipes on: with
  // Recipes off there is nowhere to show it, so every gate names both
  // (module-features.ts), and it is on for any household that has Recipes.
  defaultEnabled: true,
  enhances: ['recipes', 'groceries', 'calendar', 'assistant'],
  minSchema: '20261023130000_meal_plan',
  tables: {
    meal_plan_entries: { reach: { tools: ['get_meal_plan', 'set_meal', 'get_agenda'] }, sync: ['meals'] },
  },
  tools: [
    { name: 'get_meal_plan', kind: 'read' },
    { name: 'set_meal', kind: 'write' },
  ],
});
