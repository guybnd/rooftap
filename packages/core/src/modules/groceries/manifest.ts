import { defineModule } from '../../module-manifest';

export const groceriesModule = defineModule({
  id: 'groceries',
  label: 'Groceries',
  description: 'A shared shopping list with aisles and an item library.',
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
  slots: ['search'],
});
