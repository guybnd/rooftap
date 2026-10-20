'use client';

// ── FLUX-150: synchronous DataCache snapshot via localStorage ──────────────────
//
// DataCacheProvider's fetchAll() is async (network + IndexedDB). Before it
// resolves, the group/members/settings are null, so Legend stores can't
// initialise (they need group.id) and pages show a spinner.
//
// This module serialises the five shared fields that every section needs into
// localStorage on every successful fetch (sync write, < 5ms). On the next load
// they are read back *synchronously* and fed into useState initialisers, so the
// first render already has the group and Legend stores can start immediately.
//
// Scope: group, groupMembers, memberProfiles, userSettings, currentUserId,
// plus the household's module switches and the server's offered modules.
// Apartments / checklist / etc. are Home Search–specific and stay in IndexedDB.

import type { Group, GroupMember, GroupModuleRow, UserSettings } from '@homeup/core';

const SNAPSHOT_KEY = 'homeup_dc_v1';

interface DataCacheSnapshot {
  group: Group | null;
  groupMembers: GroupMember[];
  memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }>;
  userSettings: UserSettings | null;
  currentUserId: string | null;
  // Modules (.docs/modules.md). Optional: snapshots written before modules
  // existed lack them, which reads as "unknown" (every module on).
  groupModules?: GroupModuleRow[] | null;
  availableModules?: string[] | null;
}

export function writeDataCacheSnapshot(data: DataCacheSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(data));
  } catch {
    // Storage full or private mode — degrade gracefully.
  }
}

export function readDataCacheSnapshot(): DataCacheSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as DataCacheSnapshot) : null;
  } catch {
    return null;
  }
}
