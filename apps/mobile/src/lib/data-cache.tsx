// HOUP-86: native counterpart of apps/web's src/lib/data-cache.tsx — a slim
// group/identity provider over the platform-agnostic fetchGroupData(). Public
// shape is a subset of web's DataCache (group, currentUserId, userSettings,
// loading, isOnline, refresh) so ported screens (HOUP-81/82) import an
// identical useDataCache() hook.
//
// Deliberately resolves its own server config + Supabase client (mirroring
// app/index.tsx's own getStoredServer()/getSupabaseClient() pairing) rather
// than reading getStoreEnvironment().supabase directly — this provider can
// mount before app/index.tsx's cold-boot effect has primed that singleton,
// and getStoredServer() works fine offline, so self-priming keeps this
// correct regardless of mount order and no-ops cleanly (loading=false, no
// throw) on the first-run picker/login screens where no server is stored yet.
import * as React from 'react';
import NetInfo from '@react-native-community/netinfo';
import { usePathname, useRouter } from 'expo-router';
import {
  fetchGroupData,
  getModulesSnapshot,
  setAvailableModules,
  setServerSchema,
  setModuleRows,
  setHouseholdCurrency,
  householdCurrency,
  type ApartmentPreliminaryScore,
  type Group,
  type GroupMember,
  type GroupInvitation,
  type UserSettings,
} from '@homeup/core';
import { redirectToLogin } from './auth-redirect';
import { fetchPublicConfig, getStoredServer } from './server-config';
import { getSupabaseClient, onSupabaseClientChange } from './supabase-client';
import { readDataCacheSnapshot, writeDataCacheSnapshot } from './legend/data-cache-snapshot';
import { useGroupTableRealtime } from './use-group-table-realtime';

interface DataCache {
  group: Group | null;
  currentUserId: string | null;
  userSettings: UserSettings | null;
  // HOUP-78: fetchGroupData() already fetches apartment_preliminary_scores
  // (a raw table, not a Legend store — mirrors web's data-cache.tsx exactly)
  // for every caller; this just surfaces it the same way memberProfiles was
  // promoted in HOUP-83. null-on-fetch-error means "keep whatever's painted".
  preliminaryScores: ApartmentPreliminaryScore[];
  // HOUP-83: pass-through of fetchGroupData()'s memberProfiles — web's
  // useDataCache() already exposes this (for "uploaded by X" lines); native
  // dropped it in HOUP-86, undetected until Documents needed it.
  memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }>;
  // HOUP-84: admin/identity fields (group-manager, users-manager, invitations)
  // — fetchGroupData() already returns these; only live-state, not persisted
  // to the cold-boot snapshot below (admin screens need network anyway).
  groupMembers: GroupMember[];
  isGroupOwner: boolean;
  pendingInvitations: GroupInvitation[];
  sentInvitations: GroupInvitation[];
  loading: boolean;
  isOnline: boolean;
  // HOUP-178: set when fetchGroupData() reports a genuine query failure
  // (membership lookup, group auto-create, or the member-profiles RPC) —
  // distinct from a legitimate "no group" result. Screens should surface
  // this with a Retry (call refresh()) rather than treat group: null as fact.
  error: string | null;
  refresh: () => Promise<void>;
  /** Change this user's settings row: applied here at once (so the tab bar
      and the (tabs) navigator follow a long-press slot pick without a
      network round trip), then upserted in the background. */
  updateUserSettings: (patch: Partial<Pick<UserSettings, 'hidden_sections' | 'section_order'>>) => Promise<void>;
}

const DataCacheContext = React.createContext<DataCache>({
  group: null,
  currentUserId: null,
  userSettings: null,
  preliminaryScores: [],
  memberProfiles: {},
  groupMembers: [],
  isGroupOwner: false,
  pendingInvitations: [],
  sentInvitations: [],
  loading: true,
  isOnline: true,
  error: null,
  refresh: async () => {},
  updateUserSettings: async () => {},
});

export function useDataCache() {
  return React.useContext(DataCacheContext);
}

export function DataCacheProvider({ children }: { children: React.ReactNode }) {
  const [snapshot] = React.useState(() => {
    const snap = readDataCacheSnapshot();
    // Modules (.docs/modules.md): seed the shared modules store before any
    // screen renders, so switched-off modules never flash in on a cold start.
    // Safe during render: nothing below this provider has subscribed yet.
    setModuleRows(snap?.groupModules ?? null);
    setAvailableModules(snap?.availableModules ?? null);
    setServerSchema(snap?.serverSchema);
    setHouseholdCurrency(householdCurrency(snap?.group));
    return snap;
  });
  const [group, setGroup] = React.useState<Group | null>(snapshot?.group ?? null);
  // Money formatting everywhere reads the shared currency store (core
  // currency.ts): set it before the screens below render, notify after.
  setHouseholdCurrency(householdCurrency(group), { notify: false });
  React.useEffect(() => setHouseholdCurrency(householdCurrency(group)), [group]);
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(snapshot?.currentUserId ?? null);
  const [userSettings, setUserSettings] = React.useState<UserSettings | null>(snapshot?.userSettings ?? null);
  const [preliminaryScores, setPreliminaryScores] = React.useState<ApartmentPreliminaryScore[]>([]);
  const [memberProfiles, setMemberProfiles] = React.useState<DataCache['memberProfiles']>({});
  const [groupMembers, setGroupMembers] = React.useState<GroupMember[]>([]);
  const [isGroupOwner, setIsGroupOwner] = React.useState(false);
  const [pendingInvitations, setPendingInvitations] = React.useState<GroupInvitation[]>([]);
  const [sentInvitations, setSentInvitations] = React.useState<GroupInvitation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [isOnline, setIsOnline] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // Cold-boot race guard: the snapshot restores `group` synchronously, but the
  // Supabase client binds asynchronously (SecureStore read). If a screen sees a
  // real group.id before the client is bound, activating any group store throws
  // mid-render (getCurrentSupabaseClient fail-fast), which manifests as
  // hooks-order/useCallback-size errors. Withhold `group` until the client exists.
  const [clientReady, setClientReady] = React.useState(false);
  const fetched = React.useRef(false);
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = React.useRef(pathname);
  React.useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const fetchAll = React.useCallback(async () => {
    const server = await getStoredServer();
    if (!server) {
      // No server configured yet (first-run picker/login) — nothing to fetch,
      // and clientReady stays false so a stale snapshot group can't activate stores.
      setLoading(false);
      return;
    }

    const supabase = getSupabaseClient(server.config);
    setClientReady(true);
    // First boot after the server picker: the picker's config already says
    // which modules this server offers.
    if (snapshot?.availableModules === undefined && server.config.modules !== undefined) {
      setAvailableModules(server.config.modules ?? null);
    }
    // Same for the server's schema: the stored config answered, so a missing
    // version means a server that predates versions (core server-features.ts).
    if (snapshot?.serverSchema === undefined) setServerSchema(server.config.schemaVersion ?? null);
    // Refresh the offered modules in the background, never blocking the
    // household fetch below; a failure keeps the cached list.
    fetchPublicConfig(server.origin)
      .then((config) => {
        setAvailableModules(config.modules ?? null);
        setServerSchema(config.schemaVersion ?? null);
        const cached = readDataCacheSnapshot();
        if (cached) {
          writeDataCacheSnapshot({
            ...cached,
            availableModules: config.modules ?? null,
            serverSchema: config.schemaVersion ?? null,
          });
        }
      })
      .catch(() => {});
    // Cache-first, like web's DataCacheProvider: a returning user's snapshot
    // already holds the group, so screens paint from it now and the fetch
    // below revalidates in the background. Without this every screen sat on
    // its "Loading…" state for the whole fetchGroupData() chain (several
    // network round trips, plus a token refresh) on every cold start.
    if (snapshot?.group && snapshot.currentUserId) setLoading(false);
    const result = await fetchGroupData(supabase);

    if (result.authUnavailable) {
      // Offline, or the auth server is unreachable — keep whatever the
      // snapshot/prior state already painted rather than clearing it.
      setLoading(false);
      return;
    }

    if (result.currentUserId === null) {
      // Unauthenticated — nothing to render for this user. useAuthGuard's
      // onAuthStateChange subscription normally catches a sign-out, but the
      // very first fetchAll() run (cold boot) can race ahead of that
      // subscription binding; redirect here too instead of painting a
      // group-less screen.
      setGroup(null);
      setCurrentUserId(null);
      setUserSettings(null);
      setPreliminaryScores([]);
      setMemberProfiles({});
      setGroupMembers([]);
      setIsGroupOwner(false);
      setPendingInvitations([]);
      setSentInvitations([]);
      setModuleRows(null);
      setError(null);
      setLoading(false);
      writeDataCacheSnapshot({ group: null, userSettings: null, currentUserId: null });
      redirectToLogin(router, pathnameRef.current);
      return;
    }

    if (result.fetchError) {
      // A query genuinely failed (membership lookup, group auto-create, or
      // the member-profiles RPC) rather than legitimately returning zero
      // rows — keep whatever is currently painted and surface the error for
      // a Retry instead of silently collapsing to group: null, which would
      // look identical to a real "no group" state.
      setError(result.fetchError);
      setLoading(false);
      return;
    }

    setError(null);
    setCurrentUserId(result.currentUserId);
    const nextGroup = result.hasMembership ? result.group : null;
    setGroup(nextGroup);
    setUserSettings(result.userSettings);
    if (result.preliminaryScores !== null) setPreliminaryScores(result.preliminaryScores);
    setMemberProfiles(result.hasMembership ? result.memberProfiles : {});
    setGroupMembers(result.hasMembership ? result.groupMembers : []);
    setIsGroupOwner(result.hasMembership ? result.isGroupOwner : false);
    setSentInvitations(result.hasMembership ? result.sentInvitations : []);
    if (result.pendingInvitations !== null) setPendingInvitations(result.pendingInvitations);
    // null = the query failed (e.g. table not migrated yet): keep what's cached.
    if (!result.hasMembership) setModuleRows(null);
    else if (result.groupModules !== null) setModuleRows(result.groupModules);
    setLoading(false);

    writeDataCacheSnapshot({
      group: nextGroup,
      userSettings: result.userSettings,
      currentUserId: result.currentUserId,
      groupModules: getModulesSnapshot().rows,
      availableModules: getModulesSnapshot().available,
      serverSchema: getModulesSnapshot().schema,
    });
  }, [router, snapshot]);

  const userSettingsRef = React.useRef(userSettings);
  React.useEffect(() => {
    userSettingsRef.current = userSettings;
  }, [userSettings]);
  const updateUserSettings = React.useCallback<DataCache['updateUserSettings']>(
    async (patch) => {
      const prev = userSettingsRef.current;
      if (prev) {
        const next = { ...prev, ...patch };
        userSettingsRef.current = next;
        setUserSettings(next);
        const cached = readDataCacheSnapshot();
        if (cached) writeDataCacheSnapshot({ ...cached, userSettings: next });
      }
      try {
        const server = await getStoredServer();
        if (!server) return;
        const supabase = getSupabaseClient(server.config);
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        await supabase
          .from('user_settings')
          .upsert({ user_id: user.id, updated_at: new Date().toISOString(), ...patch }, { onConflict: 'user_id' });
        // A new user has no row to patch yet: read back the one just made.
        if (!prev) await fetchAll();
      } catch {
        // Offline: this device already shows the change; the next edit that
        // reaches the server carries it.
      }
    },
    [fetchAll]
  );

  React.useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetchAll();
  }, [fetchAll]);

  // HOUP-193: the mount-once fetch above runs before any sign-in on a fresh
  // boot (server picker/login has no session yet), so a subsequent sign-in —
  // password or Google — landed a valid session with `group`/`currentUserId`
  // still stuck at that pre-auth null result. Nothing re-ran fetchAll(), so
  // /home rendered the stale empty state until a full app reload re-primed
  // this provider from scratch. Mirrors useAuthGuard's self-priming +
  // resubscribe-on-client-change pattern so a server switch rebinds this too.
  React.useEffect(() => {
    let cancelled = false;
    let unsubscribeAuth: (() => void) | undefined;

    async function subscribe() {
      unsubscribeAuth?.();
      unsubscribeAuth = undefined;

      const server = await getStoredServer();
      if (cancelled || !server) return;

      const supabase = getSupabaseClient(server.config);
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN') fetchAll();
      });
      unsubscribeAuth = () => subscription.unsubscribe();
    }

    subscribe();
    const unsubscribeClientChange = onSupabaseClientChange(() => {
      subscribe();
    });

    return () => {
      cancelled = true;
      unsubscribeClientChange();
      unsubscribeAuth?.();
    };
  }, [fetchAll]);

  React.useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected ?? false;
      setIsOnline((prev) => {
        if (!prev && online) fetchAll();
        return online;
      });
    });
    return unsubscribe;
  }, [fetchAll]);

  // Modules: a switch flipped on another device reaches this one live, the
  // same way web's data cache refetches on a group_modules change.
  const liveGroupId = clientReady ? group?.id : null;
  useGroupTableRealtime({
    table: 'group_modules',
    groupId: liveGroupId,
    onChange: () => {
      fetchAll();
    },
  });

  // HOUP-240: this provider wraps <Stack/> (every mounted screen, current and
  // frozen) and its own render is driven by pathname changes (usePathname()
  // above) on top of its own state — a fresh object literal here forces every
  // useDataCache() consumer in the tree (every screen, not just the active
  // one) to re-render on every single nav press, regardless of whether any
  // field the screen actually reads changed. Memoized so the value's identity
  // is stable across a pathname-only re-render.
  const value = React.useMemo<DataCache>(
    () => ({
      group: clientReady ? group : null,
      currentUserId,
      userSettings,
      preliminaryScores,
      memberProfiles,
      groupMembers,
      isGroupOwner,
      pendingInvitations,
      sentInvitations,
      loading,
      isOnline,
      error,
      refresh: fetchAll,
      updateUserSettings,
    }),
    [
      clientReady,
      group,
      currentUserId,
      userSettings,
      preliminaryScores,
      memberProfiles,
      groupMembers,
      isGroupOwner,
      pendingInvitations,
      sentInvitations,
      loading,
      isOnline,
      error,
      fetchAll,
      updateUserSettings,
    ]
  );

  return <DataCacheContext.Provider value={value}>{children}</DataCacheContext.Provider>;
}
