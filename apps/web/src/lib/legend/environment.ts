'use client';

// HOUP-73: apps/web's StoreEnvironment — the browser half of the platform
// injection seam packages/core's Legend-State factory reads via
// getStoreEnvironment(). Registers itself as a side effect on import; import
// this module once, early, before any store is used (see app/layout.tsx).
//
// All browser-global access here is deferred to method call-time (never at
// module/object-construction time) and the Supabase client is created lazily
// — so importing/registering this module is safe even if it were ever
// evaluated during SSR.

// First: fills in crypto.randomUUID on plain-http self-hosted servers.
import '@/lib/random-uuid';
import type { Change } from '@legendapp/state';
import type { PersistMetadata } from '@legendapp/state/sync';
import { observablePersistIndexedDB } from '@legendapp/state/persist-plugins/indexeddb';
import { createClient } from '@/lib/supabase/client';
import { STORE_MODULES, configureStoreEnvironment, stripSymbolKeys, type StoreEnvironment } from '@homeup/core';

// Every IndexedDB-backed store's persist `name` must be declared up front: the
// plugin opens the database once and can't add object stores without a version
// bump. The list is every synced table in the module manifests (STORE_MODULES),
// and the version grows by one for each table added since version 13, so a new
// module's tables get their object stores with no edit here.
// environment.tables.test.ts fails if a table at version 13 ever leaves the
// list, which would let the count, and so the version, stand still.
export const INDEXEDDB_TABLES: string[] = Object.keys(STORE_MODULES);
/** The 40 tables at version 13 (Oct 28, 2026). Tables only join after these. */
export const INDEXEDDB_BASE = { version: 13, tables: 40 } as const;
export const INDEXEDDB_VERSION = INDEXEDDB_BASE.version + Math.max(0, INDEXEDDB_TABLES.length - INDEXEDDB_BASE.tables);

let indexedDBPlugin: ReturnType<typeof observablePersistIndexedDB> | undefined;

/**
 * The shared IndexedDB persist plugin instance. Created once on the client.
 */
function getIndexedDBPersist() {
  if (!indexedDBPlugin) {
    const plugin = observablePersistIndexedDB({
      // Pre-rename name, kept: changing it would strand every browser's local cache.
      databaseName: 'HomeUp',
      version: INDEXEDDB_VERSION,
      tableNames: INDEXEDDB_TABLES,
    });

    // Sanitize at the single shared instance so every synced store's writes
    // are covered without touching per-store config. HOUP-7: strips the
    // symbol-keyed sentinel Legend's realtime DELETE handler adds, which
    // IndexedDB's structured-clone-based put() can't serialize.
    const originalSet = plugin.set.bind(plugin);
    plugin.set = (table: string, changes: Change[], config) => {
      const sanitized = changes.map((change) => {
        const valueAtPath = stripSymbolKeys(change.valueAtPath);
        return valueAtPath === change.valueAtPath ? change : { ...change, valueAtPath };
      });
      return originalSet(table, sanitized, config);
    };

    // HOUP-299: sync METADATA takes a separate write path — `setMetadata`
    // persists `pending` (queued offline changes), which carries the same
    // Symbol(delete) tombstone sentinel, so it needs the same sanitizing or
    // every metadata write with a pending delete throws DataCloneError and
    // offline pending-change bookkeeping never persists. stripSymbolKeys also
    // returns a fresh object whenever it strips, keeping the plugin's internal
    // `Object.assign(metadata, ...)` mutation off the caller's object.
    const originalSetMetadata = plugin.setMetadata.bind(plugin);
    plugin.setMetadata = (table: string, metadata: PersistMetadata, config) =>
      originalSetMetadata(table, stripSymbolKeys(metadata), config);

    indexedDBPlugin = plugin;
  }
  return indexedDBPlugin;
}

let supabaseSingleton: ReturnType<typeof createClient> | undefined;
function getSupabase() {
  if (!supabaseSingleton) supabaseSingleton = createClient();
  return supabaseSingleton;
}

const browserStoreEnvironment: StoreEnvironment = {
  get supabase() {
    return getSupabase();
  },
  getPersistConfig(storageName, groupId) {
    // HOUP-70 group-scoping fix: `indexedDB.prefixID` keys the local table by
    // groupId too — without it, Legend's IndexedDB plugin keys purely by
    // `name`, so two groups' stores mounted in one session shared one local
    // table (only the server round-trip was actually group-scoped).
    return { name: storageName, plugin: getIndexedDBPersist(), retrySync: true, indexedDB: { prefixID: groupId } };
  },
  isOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  },
  isForeground() {
    return typeof document === 'undefined' ? true : document.visibilityState === 'visible';
  },
  subscribeReconnect(sync) {
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  },
  subscribeForeground(onForeground, onBackground) {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onForeground();
      else onBackground();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  },
  keyValue: {
    getItem(key) {
      return window.localStorage.getItem(key);
    },
    setItem(key, value) {
      window.localStorage.setItem(key, value);
    },
  },
  randomUUID: () => crypto.randomUUID(),
};

configureStoreEnvironment(browserStoreEnvironment);

// Where documents-store files live (R2 or Supabase), .docs/r2-storage.md.
import "../document-storage-env";
