import { defineModule } from '../../module-manifest';

export const groceriesModule = defineModule({
  id: 'groceries',
  label: 'Groceries',
  description: 'A shared shopping list with aisles and an item library.',
  askStarters: [{ text: 'Add everything for tacos for 6', with: ['recipes'] }, "Add milk, eggs and bread to the list"],
  iconId: 'shopping-cart',
  defaultEnabled: false,
  enhances: ['costs', 'recipes'],
  section: {
    label: 'Groceries',
    shortLabel: 'Groceries',
    basePath: '/groceries',
    acceptsShares: true,
    navItems: [
      { href: '/groceries', label: 'Shopping List', iconId: 'shopping-cart', accent: true },
      { href: '/groceries/shelf-life', label: 'Item Library', iconId: 'book-open' },
    ],
    hue: 'mint',
  },
  tables: {
    grocery_items: { reach: { tools: ['get_grocery_items', 'create_grocery_item', 'update_grocery_item', 'delete_grocery_item'] }, sync: ['groceries'] },
    grocery_aisles: { reach: { none: 'The household\'s own aisle names; each grocery item already carries its aisle.' } },
    grocery_item_library: { reach: { none: 'Fills prices and shelf life in the app; the result shows on each grocery item.' } },
    grocery_sessions: { reach: { none: 'A shopping trip\'s receipt and total; the total reaches Costs as a cost line.' } },
  },
  tools: [
    { name: 'get_grocery_items', kind: 'read' },
    { name: 'create_grocery_item', kind: 'write' },
    { name: 'update_grocery_item', kind: 'write' },
    { name: 'delete_grocery_item', kind: 'write' },
  ],
  settings: ['groceries'],
  spaces: [{ key: 'groceries', label: 'Groceries', size: 'card', lens: 'shoppingList' }],
  helper: {
    label: 'Groceries helper',
    subtitle: 'Your list, dinners and usuals',
    focus:
      "You run this household's shopping: the list, what the week's dinners need, and what is running low. " +
      'The list keeps every item the household buys: needed is the shopping list, have is in stock, bought is in the trolley. ' +
      'Work like this. The shopping list is get_grocery_items with status needed. The stock (have) is long, so do not read it all: ' +
      'to check one thing, pass search with its name. Adding a name that is already there never makes a second item: one in stock ' +
      'goes back on the list and one already needed stays as it is, and the result says which. ' +
      'Put each new item in a sensible aisle (produce, dairy, meat, bakery, pantry, frozen, household, other, or one the list already uses) ' +
      'and give a quantity and unit when the person or a recipe gives one. ' +
      "For a dinner or a recipe, read the meal plan and the recipe's ingredients, then add only what is not on the list or in stock; " +
      'say which nights each item is for. When the person says they will be out or skipping a night, take off only the items for that ' +
      'night that no other night needs. When they ask what is on the list or to catch up, show the items as rows with show_items, ' +
      'one group per aisle for the list and one for what is running low (the brief gives those ids), and add one or two lines on what matters most. ' +
      'Make every change in one reply, one tool call per item, and confirm in one short line; the items show under your reply. ' +
      'Never guess a price. Items another member keeps private are hidden from you, so do not ask about them.',
    reads: ['meals', 'recipes', 'costs'],
    writesVia: ['add_recipe_to_groceries'],
    summary: {
      label: 'Catch me up',
      ask: "Catch me up on the shop: what is on the list by aisle, what this week's dinners still need, what is running low or about to go off, and the one thing I should do first.",
    },
    starters: ["Add what this week's dinners need", "We're out Thursday, trim the list", 'What can I make with what we have?'],
  },
  slots: ['search'],
});
