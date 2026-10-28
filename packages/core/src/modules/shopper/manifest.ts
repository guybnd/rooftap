import { defineModule, REACH_REASONS } from '../../module-manifest';

export const shopperModule = defineModule({
  id: 'shopper',
  label: 'Shopper',
  description: 'Things you want to buy, with price tracking and a deal rating.',
  iconId: 'shopping-bag',
  defaultEnabled: false,
  enhances: ['household', 'costs'],
  minSchema: '20261021010000_shopper',
  section: {
    label: 'Shopper',
    shortLabel: 'Shopper',
    basePath: '/shopper',
    acceptsShares: false,
    navItems: [
      { href: '/shopper', label: 'Watching', iconId: 'shopping-bag', accent: true },
    ],
    hue: 'orchid',
  },
  tables: {
    shopper_wants: { reach: { tools: ['get_watchlist', 'watch_item', 'update_watch_item'] }, sync: ['shopper'] },
    shopper_offers: { reach: { none: 'Store offers behind each watch; the watchlist carries the best one.' }, sync: ['shopper'] },
    shopper_price_snapshots: { reach: { none: 'Price history behind the deal rating; the watchlist carries the best price.' }, sync: ['shopper'] },
    shopper_searches: { reach: { tools: ['start_scout', 'get_scout_run'] }, sync: ['shopper'] },
    shopper_picks: { reach: { tools: ['get_scout_run'] }, sync: ['shopper'] },
    shopper_scout_messages: { reach: { tools: ['get_scout_run'] } },
    shopper_source_cache: { reach: { none: REACH_REASONS.server } },
  },
  tools: [
    { name: 'get_watchlist', kind: 'read' },
    { name: 'start_scout', kind: 'write' },
    { name: 'get_scout_run', kind: 'read' },
    { name: 'watch_item', kind: 'write' },
    { name: 'update_watch_item', kind: 'write' },
  ],
  settings: ['shopper-sources'],
});
