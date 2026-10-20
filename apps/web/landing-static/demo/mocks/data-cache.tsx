// @/lib/data-cache for the screen demo: the seeded household, already loaded.
import type { ReactNode } from "react";
import { HOUSEHOLD } from "../fixtures";

const cache = {
  preliminaryScores: [],
  userSettings: HOUSEHOLD.userSettings,
  group: HOUSEHOLD.group,
  groupMembers: HOUSEHOLD.groupMembers,
  memberProfiles: HOUSEHOLD.memberProfiles,
  isGroupOwner: true,
  currentUserId: HOUSEHOLD.currentUserId,
  pendingInvitations: [],
  sentInvitations: [],
  loading: false,
  revalidating: false,
  isOnline: true,
  lastSyncedAt: new Date().toISOString(),
  refresh: async () => {},
};

export function useDataCache() {
  return cache;
}

export function DataCacheProvider({ children }: { children: ReactNode }) {
  return children;
}
