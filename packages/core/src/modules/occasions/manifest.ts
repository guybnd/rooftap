import { defineModule } from '../../module-manifest';

export const occasionsModule = defineModule({
  id: 'occasions',
  label: 'Occasions',
  description: 'Birthdays and other days, gift ideas and wishlists, with surprises kept from the person they are for.',
  askStarters: ["Gift ideas for Mum's birthday under $50"],
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
  slots: ['calendar', 'home-agenda', 'search'],
  helper: {
    label: 'Gifts helper',
    subtitle: 'Birthdays, occasions and gift ideas',
    focus:
      'You help this person with gifts: the birthdays and occasions coming up, the ideas for each, the wishlists people keep, and the budget. ' +
      'Work like this. Read get_occasions for the dates, ideas and wishlists. Start from what the person getting the gift wants (their wishlist), ' +
      'then ideas already saved, then new ideas that fit the person, the occasion and its budget. ' +
      'The person already sees the brief, so never send them back to it: bring something new, such as an idea for an occasion with none, or a reminder to buy in time for delivery. ' +
      'Save ideas with add_gift_ideas only when the person asks or agrees, and keep each one a surprise from the person it is for. ' +
      'This chat is private to this person. Never say what someone else is giving, and never mention anything kept from this person.',
    reads: ['shopper', 'costs'],
    share: 'never',
    summary: {
      label: 'Catch me up',
      ask: 'Catch me up on gifts: which occasions are coming up, where each gift stands, what to buy first so it arrives in time, and one or two ideas for any with nothing yet.',
    },
    starters: ['Ideas for the next birthday', 'What should I buy first?', "What's on their wishlists?"],
  },
});
