import { defineModule, REACH_REASONS } from '../../module-manifest';

export const setupModule = defineModule({
  id: 'setup',
  label: 'Home Setup',
  description: 'Rooms, purchases and the moving checklist for a new home.',
  iconId: 'home',
  defaultEnabled: false,
  enhances: ['search', 'costs'],
  section: {
    label: 'Home Setup',
    shortLabel: 'Setup',
    basePath: '/setup',
    acceptsShares: true,
    navItems: [
      { href: '/setup', label: 'Rooms & Checklist', iconId: 'hammer', accent: true },
    ],
    hue: 'rose',
  },
  tables: {
    setup_items: { reach: { tools: ['get_setup_items', 'create_setup_item', 'update_setup_item'] }, sync: ['setup'] },
    setup_item_comments: { reach: { none: REACH_REASONS.comments } },
    setup_stores: { reach: { none: 'Saved store names for the Setup form; each item carries where to buy it.' } },
  },
  tools: [
    { name: 'get_setup_items', kind: 'read' },
    { name: 'create_setup_item', kind: 'write' },
    { name: 'update_setup_item', kind: 'write' },
  ],
  settings: ['setup-stores'],
  spaces: [{ key: 'setup', label: 'Home Setup', size: 'tile' }],
});
