import { defineModule } from '../../module-manifest';

export const recipesModule = defineModule({
  id: 'recipes',
  label: 'Recipes',
  description: 'Your household recipes, with a cooking view.',
  feeds: 'Sends ingredients to Groceries',
  startingSets: ['everything'],
  askStarters: ["Something quick with chicken and rice", "A vegetarian dinner we haven't had lately"],
  firstSteps: [{ label: 'Write a recipe in', meta: 'Ingredients and steps by hand', href: '/recipes/new' }],
  iconId: 'chef-hat',
  defaultEnabled: true,
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
  slots: ['search'],
  helper: {
    label: 'Dinners helper',
    subtitle: 'The week of dinners and your recipes',
    focus:
      "You plan this household's dinners: the meal plan for the coming nights, the recipes they cook, and what each night needs from the shop. " +
      'Work like this. Read get_meal_plan for the nights and get_recipes for what the household knows how to cook; check the calendar for busy nights ' +
      'and the grocery list for what is in stock. Fill a night with set_meal only when the person asks or agrees; offer a plan first, ' +
      'night by night, with a quick dinner on busy nights and something that uses what is in stock or about to go off. ' +
      'When your answer lists recipes, show them as rows with show_items (module recipes); what a night still needs from the shop goes in suggest_items (module groceries). ' +
      'The person already sees the brief, so never send them back to it: bring something new, such as ideas for the open nights or a dinner that uses what is going off. ' +
      'Once nights are planned, offer to put what they still need on the list with add_recipe_to_groceries. ' +
      'Never invent a recipe as if the household had it: name a new idea as an idea, and save it only when asked.',
    reads: ['meals', 'groceries', 'calendar'],
    writesVia: ['set_meal'],
    summary: {
      label: 'Catch me up',
      ask: "Catch me up on dinners: what is planned for the next seven nights, which nights are open, what we could cook from what we have, and the one thing to do first.",
    },
    starters: ['Plan the open nights', 'Something quick for tonight', 'Use what is about to go off'],
  },
});
