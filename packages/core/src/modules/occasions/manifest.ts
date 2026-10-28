import { defineModule } from '../../module-manifest';

export const occasionsModule = defineModule({
  id: 'occasions',
  label: 'Occasions',
  description: 'Birthdays and other days, gift ideas and wishlists, with surprises kept from the person they are for.',
  iconId: 'gift',
  defaultEnabled: false,
  enhances: ['shopper', 'costs'],
  minSchema: '20261023100000_occasions',
  section: {
    label: 'Occasions',
    shortLabel: 'Occasions',
    basePath: '/occasions',
    acceptsShares: false,
    navItems: [
      { href: '/occasions', label: 'Occasions', iconId: 'gift', accent: true },
    ],
    hue: 'cherry',
  },
  tables: {
    occasions: { reach: { tools: ['get_occasions', 'add_occasion', 'get_agenda'] }, sync: ['occasions'] },
    gift_ideas: { reach: { tools: ['get_occasions', 'add_gift_ideas'] }, sync: ['occasions'] },
    wishlist_items: { reach: { tools: ['get_occasions', 'add_wishlist_items'] }, sync: ['occasions'] },
  },
  tools: [
    { name: 'get_occasions', kind: 'read' },
    { name: 'add_occasion', kind: 'write' },
    { name: 'add_gift_ideas', kind: 'write' },
    { name: 'add_wishlist_items', kind: 'write' },
  ],
});
