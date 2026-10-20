// HOUP-86: apps/mobile's StoreEnvironment — the native half of the platform
// injection seam packages/core's Legend-State factory reads via
// getStoreEnvironment(). Registers itself as a side effect on import; import
// this module once, early, before any store is used (see app/_layout.tsx).
//
// Mirrors apps/web/src/lib/legend/environment.ts member-for-member — see
// that file for the seam's design intent. Only the platform primitives
// differ: expo-sqlite instead of IndexedDB, NetInfo/AppState instead of
// navigator/document, and the already-bound native Supabase client (primed
// via getSupabaseClient() elsewhere — see supabase-client.ts) instead of a
// build-time-configured browser client.

import { observablePersistSqlite } from '@legendapp/state/persist-plugins/expo-sqlite';
import { SQLiteStorage } from 'expo-sqlite/kv-store';
import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import * as Crypto from 'expo-crypto';
import { configureStoreEnvironment, type StoreEnvironment } from '@homeup/core';
import { getCurrentSupabaseClient } from '../supabase-client';

// Pre-rename file name, kept: changing it would strand every install's local cache.
const sqliteStorage = new SQLiteStorage('HomeUp.db');

let persistPlugin: ReturnType<typeof observablePersistSqlite> | undefined;
function getSqlitePersist() {
  if (!persistPlugin) {
    persistPlugin = observablePersistSqlite(sqliteStorage);
  }
  return persistPlugin;
}

// isOnline() must be synchronous (the seam's contract), but NetInfo.fetch()
// is async — cache the last-known state via a standing listener instead.
let cachedIsConnected = true;
NetInfo.addEventListener((state) => {
  cachedIsConnected = state.isConnected ?? false;
});

const nativeStoreEnvironment: StoreEnvironment = {
  get supabase() {
    return getCurrentSupabaseClient();
  },
  getPersistConfig(storageName, groupId) {
    // HOUP-70 group-scoping fix, SQLite half: expo-sqlite's persist plugin has
    // no IndexedDB-style `prefixID` option, so groupId is folded straight
    // into the persist `name` — two groups' stores never share one local
    // table.
    return { name: `${storageName}__${groupId}`, plugin: getSqlitePersist(), retrySync: true };
  },
  isOnline() {
    return cachedIsConnected;
  },
  isForeground() {
    return AppState.currentState === 'active';
  },
  subscribeReconnect(sync) {
    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected) sync();
    });
    const onAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') sync();
    };
    const appStateSub = AppState.addEventListener('change', onAppStateChange);
    return () => {
      netSub();
      appStateSub.remove();
    };
  },
  subscribeForeground(onForeground, onBackground) {
    const onAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') onForeground();
      else onBackground();
    };
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  },
  keyValue: {
    getItem(key) {
      return sqliteStorage.getItemSync(key);
    },
    setItem(key, value) {
      sqliteStorage.setItemSync(key, value);
    },
  },
  randomUUID: () => Crypto.randomUUID(),
};

configureStoreEnvironment(nativeStoreEnvironment);

export { nativeStoreEnvironment };
