// Modules (.docs/modules.md, step 8): which modules' data lives in each synced
// group table. A household syncs a table only while one of its modules is on:
// the app-wide sync bootstrap and every read outside the module's own screens
// open the store with syncedGroupId(), which hands back no group id (the inert
// empty store, which never syncs) once every module that uses it is off.
// Turning a module back on syncs its tables again without a reload.
//
// Write paths that cross into another module's table (a checklist removing
// the cost line it logged) still open that store directly, so the write
// lands; the store then syncs for the rest of that session.

import type { ModuleId } from './modules';

export const STORE_MODULES = {
  // Bill and document reminders are household tasks that belong to Costs and
  // Documents (task-modules.ts), so the table syncs while any of the three is on.
  household_tasks: ['household', 'costs', 'documents'],
  grocery_items: ['groceries'],
  loyalty_cards: ['groceries'],
  cost_items: ['costs'],
  setup_items: ['setup'],
  checklists: ['checklists'],
  checklist_task_items: ['checklists'],
  checklist_templates: ['checklists'],
  checklist_template_items: ['checklists'],
  recipes: ['recipes'],
  recipe_ingredients: ['recipes'],
  events: ['calendar'],
  documents: ['documents'],
  shopper_wants: ['shopper'],
  shopper_offers: ['shopper'],
  shopper_price_snapshots: ['shopper'],
  shopper_searches: ['shopper'],
  shopper_picks: ['shopper'],
  // Home Search: listings, agents, viewings and the listing checklist.
  apartments: ['search'],
  agents: ['search'],
  apartment_agents: ['search'],
  apartment_comments: ['search'],
  saved_searches: ['search'],
  appointments: ['search'],
  checklist_items: ['search'],
  checklist_responses: ['search'],
} as const satisfies Record<string, readonly ModuleId[]>;

export type StoreCollection = keyof typeof STORE_MODULES;

/** Whether a household with these modules on syncs this table. A table no module claims always syncs. */
export function isStoreSynced(collection: string, enabled: ReadonlySet<string>): boolean {
  const modules = (STORE_MODULES as Record<string, readonly ModuleId[]>)[collection];
  return !modules || modules.some((m) => enabled.has(m));
}

/**
 * The group id to open `store$` with: the household's while one of the store's
 * modules is on, otherwise undefined, which gives the inert empty store.
 */
export function syncedGroupId(
  store$: { collection: string },
  groupId: string | null | undefined,
  enabled: ReadonlySet<string>,
): string | undefined {
  if (!groupId) return undefined;
  return isStoreSynced(store$.collection, enabled) ? groupId : undefined;
}
