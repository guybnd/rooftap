// HOUP-86: native counterpart of apps/web's
// src/lib/legend/data-cache-snapshot.ts — persists the group/identity fields
// DataCacheProvider needs so `group.id` resolves on a cold, offline start.
// Backed by expo-sqlite's synchronous kv-store (via the shared
// nativeStoreEnvironment.keyValue) instead of localStorage.
import type { Group, GroupModuleRow, UserSettings } from '@homeup/core';
import { nativeStoreEnvironment } from './environment';

const SNAPSHOT_KEY = 'homeup_dc_v1';

interface DataCacheSnapshot {
  group: Group | null;
  userSettings: UserSettings | null;
  currentUserId: string | null;
  // Modules (.docs/modules.md). Optional: snapshots written before modules
  // existed lack them, which reads as "unknown" (every module on).
  groupModules?: GroupModuleRow[] | null;
  availableModules?: string[] | null;
  // The server's schema (core server-features.ts). Absent = not known yet;
  // null = the server predates schema versions.
  serverSchema?: string | null;
}

export function writeDataCacheSnapshot(data: DataCacheSnapshot): void {
  try {
    nativeStoreEnvironment.keyValue.setItem(SNAPSHOT_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — degrade gracefully.
  }
}

export function readDataCacheSnapshot(): DataCacheSnapshot | null {
  try {
    const raw = nativeStoreEnvironment.keyValue.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as DataCacheSnapshot) : null;
  } catch {
    return null;
  }
}
