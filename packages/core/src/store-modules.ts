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
import { ALL_MANIFESTS } from './module-manifests';

/** Synced table -> the modules whose being on syncs it, from each manifest's `sync` tables. */
export const STORE_MODULES: Readonly<Record<string, readonly ModuleId[]>> = Object.fromEntries(
  ALL_MANIFESTS.flatMap((m) =>
    Object.entries(m.tables ?? {}).flatMap(([table, t]) => (t.sync ? [[table, t.sync as readonly ModuleId[]]] : [])),
  ),
);

export type StoreCollection = string;

/** Whether a household with these modules on syncs this table. A table no module claims always syncs. */
export function isStoreSynced(collection: string, enabled: ReadonlySet<string>): boolean {
  const modules = STORE_MODULES[collection];
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
