"use client";

import { createContext, useContext, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { putAll, getAll, setMeta, getMeta, STORES } from "@/lib/offline-store";
import { readDataCacheSnapshot, writeDataCacheSnapshot } from "@/lib/legend/data-cache-snapshot";
import { fetchGroupData, getModulesSnapshot, householdCurrency, isPublicConfig, setAvailableModules, setHouseholdCurrency, setModuleRows, setServerSchema } from "@homeup/core";
import type { ApartmentPreliminaryScore, UserSettings, Group, GroupMember, GroupInvitation } from '@homeup/core';

// FLUX-150 slice 8: DataCacheProvider is now a slim group/identity provider.
// Every section table it used to fetch directly (apartments, agents,
// apartment_agents, apartment_comments, appointments, checklist_items,
// checklist_responses, saved_searches) has migrated to its own Legend-State
// store (src/lib/legend/*-store.ts) — read those via `use$`, not this context.
// `apartment_preliminary_scores` is the one exception: it was never in this
// ticket's migration scope, so it's still fetched/cached here.

interface DataCache {
  preliminaryScores: ApartmentPreliminaryScore[];
  userSettings: UserSettings | null;
  group: Group | null;
  groupMembers: GroupMember[];
  memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }>;
  isGroupOwner: boolean;
  currentUserId: string | null;
  pendingInvitations: GroupInvitation[];
  sentInvitations: GroupInvitation[];
  loading: boolean;
  revalidating: boolean;
  isOnline: boolean;
  lastSyncedAt: string | null;
  refresh: () => Promise<void>;
}

// Modules (.docs/modules.md): hydrate the shared modules store from the
// cold-boot snapshot before anything renders, so a returning user's switched-off
// modules are gone from the first client render rather than after the fetch.
// Module scope, not an effect: the section switcher reads the store from
// outside this provider.
if (typeof window !== "undefined") {
  const snap = readDataCacheSnapshot();
  setModuleRows(snap?.groupModules ?? null);
  setAvailableModules(snap?.availableModules ?? null);
  setServerSchema(snap?.serverSchema);
  setHouseholdCurrency(householdCurrency(snap?.group));
}

// The modules this server offers come from the same endpoint the native app's
// server picker reads. Runs alongside the household fetch without blocking it;
// a failure leaves the last known list in place.
async function refreshAvailableModules(): Promise<void> {
  try {
    const res = await fetch("/api/public-config");
    if (!res.ok) return;
    const json: unknown = await res.json();
    if (!isPublicConfig(json)) return;
    setAvailableModules(json.modules ?? null);
    setServerSchema(json.schemaVersion ?? null);
    const cached = readDataCacheSnapshot();
    if (cached) {
      writeDataCacheSnapshot({ ...cached, availableModules: json.modules ?? null, serverSchema: json.schemaVersion ?? null });
    }
  } catch {
    // Offline or unreachable: keep the cached list.
  }
}

const DataCacheContext = createContext<DataCache>({
  preliminaryScores: [],
  userSettings: null,
  group: null,
  groupMembers: [],
  memberProfiles: {},
  isGroupOwner: false,
  currentUserId: null,
  pendingInvitations: [],
  sentInvitations: [],
  loading: true,
  revalidating: false,
  isOnline: true,
  lastSyncedAt: null,
  refresh: async () => {},
});

export function useDataCache() {
  return useContext(DataCacheContext);
}

export function DataCacheProvider({ children }: { children: React.ReactNode }) {
  const [preliminaryScores, setPreliminaryScores] = useState<ApartmentPreliminaryScore[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(() => readDataCacheSnapshot()?.userSettings ?? null);
  const [group, setGroup] = useState<Group | null>(() => readDataCacheSnapshot()?.group ?? null);
  // Money formatting everywhere reads the shared currency store (core
  // currency.ts): set it before the screens below render, notify after.
  setHouseholdCurrency(householdCurrency(group), { notify: false });
  useEffect(() => setHouseholdCurrency(householdCurrency(group)), [group]);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>(() => readDataCacheSnapshot()?.groupMembers ?? []);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, { email: string; name: string | null; avatar: string | null }>>(() => readDataCacheSnapshot()?.memberProfiles ?? {});
  const [isGroupOwner, setIsGroupOwner] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => readDataCacheSnapshot()?.currentUserId ?? null);
  const [pendingInvitations, setPendingInvitations] = useState<GroupInvitation[]>([]);
  const [sentInvitations, setSentInvitations] = useState<GroupInvitation[]>([]);
  // The snapshot check must not live in the useState initializer: that
  // function also runs during the client hydration render, and unlike the
  // server (no window) it can read a real localStorage snapshot there —
  // producing loading=false on the client vs loading=true on the server, a
  // hydration mismatch. Start deterministically true (matching SSR) and
  // resolve the cache-first fast path in a useLayoutEffect instead, which
  // fires before the browser paints so returning users still see no spinner.
  const [loading, setLoading] = useState(true);
  // Tracks fetchAll() runs that happen *after* a cache-first paint (loading
  // already false) — the "revalidating in the background" case the non-blocking
  // indicator surfaces, as opposed to the very first load (which `loading` covers).
  const [revalidating, setRevalidating] = useState(false);
  const loadingRef = useRef(loading);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useLayoutEffect(() => {
    if (readDataCacheSnapshot()?.group) {
      setLoading(false);
    }
  }, []);
  const [isOnline, setIsOnline] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const fetched = useRef(false);
  // FLUX-88: timestamp of the last fetchAll (for focus throttling) + a debounce
  // timer so a burst of realtime events coalesces into a single refetch.
  const lastFetchAtRef = useRef(0);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFromOfflineStore = useCallback(async () => {
    try {
      const [prelimScores, settingsData, groupsData, membersData, invitationsData] = await Promise.all([
        getAll<ApartmentPreliminaryScore>(STORES.preliminaryScores),
        getAll<UserSettings>(STORES.userSettings),
        getAll<Group>(STORES.groups),
        getAll<GroupMember>(STORES.groupMembers),
        getAll<GroupInvitation>(STORES.groupInvitations),
      ]);

      setPreliminaryScores(prelimScores);
      setUserSettings(settingsData[0] ?? null);
      setGroup(groupsData[0] ?? null);
      setGroupMembers(membersData);
      setSentInvitations(invitationsData);

      const storedUserId = await getMeta<string | null>("currentUserId");
      setCurrentUserId(storedUserId ?? null);

      const storedPendingInvitations = await getMeta<GroupInvitation[]>("pendingInvitations");
      setPendingInvitations(storedPendingInvitations ?? []);

      const storedMembership = await getMeta<{ group_id: string; role: string }>("membership");
      if (storedMembership) {
        setIsGroupOwner(storedMembership.role === "owner");
      }

      const storedProfiles = await getMeta<Record<string, { email: string; name: string | null; avatar: string | null }>>("memberProfiles");
      if (storedProfiles) {
        setMemberProfiles(storedProfiles);
      }

      const syncedAt = await getMeta<string>("lastSyncedAt");
      setLastSyncedAt(syncedAt ?? null);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchAll = useCallback(async () => {
    lastFetchAtRef.current = Date.now();
    if (!navigator.onLine) {
      await loadFromOfflineStore();
      return;
    }

    if (!loadingRef.current) setRevalidating(true);

    const supabase = createClient();
    void refreshAvailableModules();
    const result = await fetchGroupData(supabase);

    if (result.authUnavailable) {
      // Online, but the session couldn't be verified/refreshed (network blip,
      // unreachable auth server, expired token that failed to refresh) — treat
      // like offline rather than a sign-out, so cached group/section data
      // survives instead of every group.id-keyed section going blank. The
      // online/focus listeners further down retry once connectivity returns.
      // The "reopen while airplane-mode past token expiry" case additionally
      // depends on FLUX-1546's offline shell to serve the page at all before
      // this code ever runs; this branch covers "online but auth unreachable".
      await loadFromOfflineStore();
      setRevalidating(false);
      return;
    }

    setCurrentUserId(result.currentUserId);

    if (result.pendingInvitations !== null) {
      setPendingInvitations(result.pendingInvitations);
      setMeta("pendingInvitations", result.pendingInvitations).catch(() => {});
    }

    if (result.hasMembership) {
      setGroup(result.group);
      setGroupMembers(result.groupMembers);
      setMemberProfiles(result.memberProfiles);
      setIsGroupOwner(result.isGroupOwner);
      setSentInvitations(result.sentInvitations);
      // null = the query failed (e.g. table not migrated yet): keep what's cached.
      if (result.groupModules !== null) setModuleRows(result.groupModules);

      // Persist group-related data to IndexedDB
      try {
        await Promise.all([
          putAll(STORES.groups, result.group ? [result.group] : []),
          putAll(STORES.groupMembers, result.groupMembers),
          putAll(STORES.groupInvitations, result.sentInvitations),
          setMeta("membership", result.membership),
          setMeta("memberProfiles", result.memberProfiles),
        ]);
      } catch {
        // silent
      }
    } else {
      // No membership resolved (signed out, or the auto-create above failed) —
      // a stale group painted from the localStorage snapshot must not linger
      // forever once a real session check has run and found none.
      setGroup(null);
      setGroupMembers([]);
      setMemberProfiles({});
      setIsGroupOwner(false);
      setSentInvitations([]);
      setModuleRows(null);
    }

    setUserSettings(result.userSettings);

    // A transient failure here must not blank previously-cached preliminary
    // scores — keep cached data and skip only the update on error.
    if (result.preliminaryScores !== null) {
      setPreliminaryScores(result.preliminaryScores);
      try {
        await putAll(STORES.preliminaryScores, result.preliminaryScores);
      } catch {
        // silent
      }
    }

    setLoading(false);
    setRevalidating(false);

    writeDataCacheSnapshot({
      group: result.group,
      groupMembers: result.groupMembers,
      memberProfiles: result.memberProfiles,
      userSettings: result.userSettings,
      currentUserId: result.currentUserId,
      groupModules: getModulesSnapshot().rows,
      availableModules: getModulesSnapshot().available,
      serverSchema: getModulesSnapshot().schema,
    });

    // Persist to IndexedDB for offline access.
    try {
      await Promise.all([
        result.userSettings ? putAll(STORES.userSettings, [result.userSettings]) : Promise.resolve(),
        setMeta("lastSyncedAt", new Date().toISOString()),
        setMeta("currentUserId", result.currentUserId),
      ]);
      setLastSyncedAt(new Date().toISOString());
    } catch {
      // IndexedDB write failed silently — app still works online
    }
  }, []);

  // Coalesce bursty triggers (realtime fan-out) into a single trailing refetch.
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      fetchAll();
    }, 400);
  }, [fetchAll]);

  useEffect(() => {
    if (!fetched.current) {
      fetched.current = true;
      // For returning users (snapshot has group): hydrate IndexedDB first so pages
      // paint cached content immediately, then revalidate from the network in the
      // background (stale-while-revalidate). For first-time users: go straight to
      // the network fetch (no IDB to hydrate from).
      if (navigator.onLine && readDataCacheSnapshot()?.group) {
        loadFromOfflineStore().then(() => fetchAll());
      } else {
        fetchAll();
      }
    }
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    };
  }, [fetchAll, loadFromOfflineStore]);

  // Online/offline detection and sync on reconnect
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      fetchAll();
    };
    const handleOffline = () => setIsOnline(false);

    // Sync initial state after mount
    setIsOnline(navigator.onLine);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Poll navigator.onLine as a fallback (DevTools offline toggle doesn't always fire events)
    const interval = setInterval(() => {
      setIsOnline((prev) => {
        const current = navigator.onLine;
        if (!prev && current) fetchAll();
        return current;
      });
    }, 3000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [fetchAll]);

  // Revalidate on window focus — but only if the data is stale (>30s), so
  // alt-tabbing doesn't reload the entire dataset on every focus.
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastFetchAtRef.current > 30_000) fetchAll();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchAll]);

  // Realtime updates — group/identity + the one still-unmigrated table
  // (apartment_preliminary_scores). Every other section table now owns its
  // own realtime subscription via its Legend store.
  useEffect(() => {
    const supabase = createClient();

    // Any row change schedules one debounced refetch, so a multi-row/multi-table
    // change doesn't fan out into a dozen full reloads.
    const channel = supabase
      .channel("data-cache-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "apartment_preliminary_scores" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_settings" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_invitations" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_modules" }, scheduleRefetch)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [scheduleRefetch]);

  return (
    <DataCacheContext.Provider value={{ preliminaryScores, userSettings, group, groupMembers, memberProfiles, isGroupOwner, currentUserId, pendingInvitations, sentInvitations, loading, revalidating, isOnline, lastSyncedAt, refresh: fetchAll }}>
      {children}
    </DataCacheContext.Provider>
  );
}
