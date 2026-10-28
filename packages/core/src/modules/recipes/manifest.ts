import { defineModule } from '../../module-manifest';

export const recipesModule = defineModule({
  id: 'recipes',
  label: 'Recipes',
  description: 'Your household recipes, with a cooking view.',
  iconId: 'chef-hat',
  defaultEnabled: false,
  enhances: ['groceries'],
  section: {
    label: 'Recipes',
    shortLabel: 'Recipes',
    basePath: '/recipes',
    acceptsShares: false,
    navItems: [
      { href: '/recipes', label: 'All recipes', iconId: 'chef-hat', accent: true },
    ],
    hue: 'peach',
  },
  tables: {
    recipes: { reach: { tools: ['get_recipes', 'save_recipe', 'add_recipe_to_groceries', 'get_meal_plan'] }, sync: ['recipes'] },
    recipe_ingredients: { reach: { tools: ['get_recipes', 'save_recipe', 'add_recipe_to_groceries'] }, sync: ['recipes'] },
    recipe_staples: { reach: { tools: ['add_recipe_to_groceries'] }, sync: ['recipes'] },
    ingredient_aliases: { reach: { tools: ['add_recipe_to_groceries'] }, sync: ['recipes'] },
    cook_sessions: { reach: { tools: ['get_running_cooks', 'start_timer'] }, sync: ['recipes'] },
  },
  tools: [
    { name: 'get_recipes', kind: 'read' },
    { name: 'add_recipe_to_groceries', kind: 'write' },
    { name: 'get_recipe_steps', kind: 'read' },
    { name: 'get_running_cooks', kind: 'read' },
    { name: 'start_timer', kind: 'write' },
    { name: 'save_recipe', kind: 'write' },
  ],
});
