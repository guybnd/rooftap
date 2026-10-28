import { defineModule, REACH_REASONS } from '../../module-manifest';

export const searchModule = defineModule({
  id: 'search',
  label: 'Home Search',
  description: 'Listings, viewings, agents and a map while you look for a place.',
  iconId: 'layout-dashboard',
  defaultEnabled: false,
  enhances: ['calendar', 'setup'],
  section: {
    label: 'Home Search',
    shortLabel: 'Search',
    basePath: '/homesearch',
    acceptsShares: true,
    navItems: [
      { href: '/apartment/new', label: 'Add Listing', iconId: 'plus-circle', accent: true },
      { href: '/apartment/bulk', label: 'Bulk Upload', iconId: 'list-plus' },
      { href: '/homesearch', label: 'Overview', iconId: 'layout-dashboard' },
      { href: '/map', label: 'Map View', iconId: 'map' },
      { href: '/appointments', label: 'Appointments', iconId: 'clipboard-list' },
      { href: '/checklist', label: 'Apartment Checklist', iconId: 'clipboard-check' },
    ],
    hue: 'teal',
    // "/checklist" (singular, apartment scoring) is not under "/checklists",
    // so it and the other listing routes resolve to Home Search by default.
    tabRoutes: ['/appointments', '/checklist'],
  },
  tables: {
    apartments: { reach: { tools: ['get_home_search'] }, sync: ['search'] },
    appointments: { reach: { tools: ['get_home_search'] }, sync: ['search'] },
    agents: { reach: { none: 'Agents\' contact details; the listing is what people ask about.' }, sync: ['search'] },
    apartment_agents: { reach: { none: 'Links listings to agents.' }, sync: ['search'] },
    apartment_comments: { reach: { none: REACH_REASONS.comments }, sync: ['search'] },
    apartment_preliminary_scores: { reach: { none: 'Each member\'s own first score; the listing carries the score.' } },
    photos: { reach: { none: 'Listing photos; the Assistant works with text.' } },
    checklist_items: { reach: { none: 'The old per-person viewing checklist for listings.' }, sync: ['search'] },
    checklist_responses: { reach: { none: 'Answers to the old viewing checklist.' }, sync: ['search'] },
    saved_searches: { reach: { none: 'Saved listing searches on the map.' }, sync: ['search'] },
    warranty_asset_comments: { reach: { none: 'Left over from the retired warranties section; warranties are documents now.' } },
  },
  tools: [
    { name: 'get_home_search', kind: 'read' },
  ],
  settings: ['search-budget', 'search-appointments', 'search-saved', 'search-agents'],
  spaces: [{ key: 'search', label: 'Home Search', size: 'tile' }],
});
