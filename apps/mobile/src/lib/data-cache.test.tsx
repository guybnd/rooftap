// HOUP-131: caller-seam coverage for `DataCacheProvider` (data-cache.tsx) —
// HOUP-96 covered nativeStoreEnvironment's pure leaves only; this drives the
// assembled provider itself through its snapshot-hydrate and offline-no-op
// paths with a mocked `fetchGroupData`, per apps/web's data-cache.test.tsx
// sibling pattern (mock the platform seams, not React itself). Mobile has no
// jsdom/testing-library wired (see vitest.config.ts) — `react-test-renderer`
// is enough here since DataCacheProvider renders no host components, only
// `Context.Provider` + children.
import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Group, UserSettings } from '@homeup/core';

const netInfoListeners = new Set<(state: { isConnected: boolean | null }) => void>();

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: vi.fn((listener: (state: { isConnected: boolean | null }) => void) => {
      netInfoListeners.add(listener);
      return () => netInfoListeners.delete(listener);
    }),
  },
}));

// data-cache.tsx imports `usePathname`/`useRouter` for its redirect-to-login
// effect. Left unmocked, importing the real `expo-router` pulls in
// react-native-safe-area-context, whose commonjs build ships untransformed
// .tsx that this suite's `environment: 'node'` runner cannot parse
// ("Unexpected token 'typeof'"). It's a platform seam like the others here,
// so it gets mocked rather than transformed — see vitest.config.ts on why
// this suite stays pure-logic. `./auth-redirect` needs no mock: it imports
// `useRouter` as a type only, which is erased.
const routerReplace = vi.fn();
vi.mock('expo-router', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: routerReplace, push: vi.fn(), back: vi.fn() }),
}));

const fetchGroupData = vi.fn();
vi.mock('@homeup/core', () => ({
  fetchGroupData,
  setModuleRows: vi.fn(),
  setAvailableModules: vi.fn(),
  setServerSchema: vi.fn(),
  getModulesSnapshot: () => ({ rows: null, available: null }),
  setHouseholdCurrency: vi.fn(),
  householdCurrency: () => 'AUD',
}));

const getStoredServer = vi.fn();
const fetchPublicConfig = vi.fn(() => Promise.reject(new Error('offline')));
vi.mock('./server-config', () => ({ getStoredServer, fetchPublicConfig }));

vi.mock('./use-group-table-realtime', () => ({ useGroupTableRealtime: vi.fn() }));

const getSupabaseClient = vi.fn();
const onSupabaseClientChange = vi.fn(() => () => {});
vi.mock('./supabase-client', () => ({ getSupabaseClient, onSupabaseClientChange }));

const readDataCacheSnapshot = vi.fn();
const writeDataCacheSnapshot = vi.fn();
vi.mock('./legend/data-cache-snapshot', () => ({ readDataCacheSnapshot, writeDataCacheSnapshot }));

// The HOUP-193 resubscribe effect calls `supabase.auth.onAuthStateChange`
// directly (independent of `fetchGroupData`, which is mocked above) — every
// fakeClient handed to `getSupabaseClient` needs this shape or that effect
// throws on a real Supabase client's absence.
function fakeSupabaseClient(
  onAuthStateChange: (
    callback: (event: string) => void
  ) => { data: { subscription: { unsubscribe: () => void } } } = () => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })
) {
  return { __client: 'fake', auth: { onAuthStateChange } };
}

function fixtureGroup(id: string): Group {
  return {
    id,
    name: 'Cached Group',
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00.000Z',
    region: 'AU',
    home_address: null,
    home_lat: null,
    home_lng: null,
    home_move_in_date: null,
    chosen_apartment_id: null,
  };
}

const FETCH_RESULT_DEFAULTS = {
  authUnavailable: false,
  hasMembership: false,
  membership: null,
  group: null,
  groupMembers: [],
  memberProfiles: {},
  isGroupOwner: false,
  sentInvitations: [],
  pendingInvitations: null,
  userSettings: null as UserSettings | null,
  preliminaryScores: null,
};

async function renderProvider() {
  const { DataCacheProvider, useDataCache } = await import('./data-cache');
  let latest: ReturnType<typeof useDataCache> | undefined;
  function Probe() {
    latest = useDataCache();
    return null;
  }

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <DataCacheProvider>
        <Probe />
      </DataCacheProvider>
    );
  });

  const deadline = Date.now() + 2000;
  while ((latest?.loading ?? true) && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  return {
    renderer,
    getValue: () => {
      if (!latest) throw new Error('DataCacheProvider never rendered the probe');
      return latest;
    },
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe('DataCacheProvider', () => {
  let renderers: ReactTestRenderer[] = [];

  beforeEach(() => {
    vi.resetModules();
    netInfoListeners.clear();
    fetchGroupData.mockReset();
    getStoredServer.mockReset();
    getSupabaseClient.mockReset();
    onSupabaseClientChange.mockReset().mockReturnValue(() => {});
    readDataCacheSnapshot.mockReset().mockReturnValue(null);
    writeDataCacheSnapshot.mockReset();
    renderers = [];
  });

  afterEach(() => {
    for (const renderer of renderers) {
      act(() => renderer.unmount());
    }
  });

  it('offline-no-op path: no server configured skips fetchGroupData and stops loading', async () => {
    const cachedGroup = fixtureGroup('group-cached-offline');
    readDataCacheSnapshot.mockReturnValue({
      group: cachedGroup,
      userSettings: null,
      currentUserId: 'user-cached',
    });
    getStoredServer.mockResolvedValue(null);

    const { renderer, getValue } = await renderProvider();
    renderers.push(renderer);

    expect(fetchGroupData).not.toHaveBeenCalled();
    expect(getValue().loading).toBe(false);
    // clientReady never flips true (no server bound) — the exposed group
    // stays withheld even though the snapshot seeded internal state, guarding
    // against activating a group store before a Supabase client exists.
    expect(getValue().group).toBeNull();
    expect(getValue().currentUserId).toBe('user-cached');
  });

  it('snapshot-hydrate path: fetchGroupData populates the group and persists a fresh snapshot', async () => {
    readDataCacheSnapshot.mockReturnValue(null);
    getStoredServer.mockResolvedValue({
      origin: 'https://example.test',
      isOfficial: false,
      config: { supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' },
    });
    const fakeClient = fakeSupabaseClient();
    getSupabaseClient.mockReturnValue(fakeClient);

    const remoteGroup = fixtureGroup('group-remote');
    fetchGroupData.mockResolvedValue({
      ...FETCH_RESULT_DEFAULTS,
      currentUserId: 'user-1',
      hasMembership: true,
      group: remoteGroup,
    });

    const { renderer, getValue } = await renderProvider();
    renderers.push(renderer);

    expect(getSupabaseClient).toHaveBeenCalledWith({ supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
    expect(fetchGroupData).toHaveBeenCalledWith(fakeClient);
    expect(getValue().group).toEqual(remoteGroup);
    expect(getValue().currentUserId).toBe('user-1');
    expect(writeDataCacheSnapshot).toHaveBeenCalledWith({
      group: remoteGroup,
      userSettings: null,
      currentUserId: 'user-1',
      groupModules: null,
      availableModules: null,
    });
  });

  it('cache-first path: a snapshot with a group paints without waiting on fetchGroupData', async () => {
    const cachedGroup = fixtureGroup('group-cached-first');
    readDataCacheSnapshot.mockReturnValue({
      group: cachedGroup,
      userSettings: null,
      currentUserId: 'user-cached',
    });
    getStoredServer.mockResolvedValue({
      origin: 'https://example.test',
      isOfficial: false,
      config: { supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' },
    });
    getSupabaseClient.mockReturnValue(fakeSupabaseClient());
    // The network fetch never settles, as on a slow cold-start connection.
    fetchGroupData.mockReturnValue(new Promise(() => {}));

    const { renderer, getValue } = await renderProvider();
    renderers.push(renderer);

    expect(fetchGroupData).toHaveBeenCalled();
    expect(getValue().loading).toBe(false);
    expect(getValue().group).toEqual(cachedGroup);
  });

  it('authUnavailable path: keeps the snapshot-seeded group instead of clearing it', async () => {
    const cachedGroup = fixtureGroup('group-cached-authunavailable');
    readDataCacheSnapshot.mockReturnValue({
      group: cachedGroup,
      userSettings: null,
      currentUserId: 'user-cached',
    });
    getStoredServer.mockResolvedValue({
      origin: 'https://example.test',
      isOfficial: false,
      config: { supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' },
    });
    getSupabaseClient.mockReturnValue(fakeSupabaseClient());
    fetchGroupData.mockResolvedValue({ ...FETCH_RESULT_DEFAULTS, authUnavailable: true });

    const { renderer, getValue } = await renderProvider();
    renderers.push(renderer);

    expect(getValue().loading).toBe(false);
    expect(getValue().group).toEqual(cachedGroup);
    expect(writeDataCacheSnapshot).not.toHaveBeenCalled();
  });

  it('SIGNED_IN re-fetch path (HOUP-193): an onAuthStateChange SIGNED_IN event re-runs fetchAll', async () => {
    readDataCacheSnapshot.mockReturnValue(null);
    getStoredServer.mockResolvedValue({
      origin: 'https://example.test',
      isOfficial: false,
      config: { supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' },
    });

    let authStateCallback: ((event: string) => void) | undefined;
    const onAuthStateChange = vi.fn((callback: (event: string) => void) => {
      authStateCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    getSupabaseClient.mockReturnValue(fakeSupabaseClient(onAuthStateChange));

    // Pre-sign-in fetch: modeled as `authUnavailable` (same as the
    // "authUnavailable path" test above) rather than a null `currentUserId` —
    // the latter drives DataCacheProvider's redirectToLogin()/useRouter()
    // branch, which isn't mocked in this file and is out of scope here; this
    // test targets only the HOUP-193 resubscribe-triggers-refetch glue.
    const postSignInGroup = fixtureGroup('group-post-signin');
    fetchGroupData
      .mockResolvedValueOnce({ ...FETCH_RESULT_DEFAULTS, authUnavailable: true })
      .mockResolvedValueOnce({
        ...FETCH_RESULT_DEFAULTS,
        currentUserId: 'user-1',
        hasMembership: true,
        group: postSignInGroup,
      });

    const { renderer, getValue } = await renderProvider();
    renderers.push(renderer);

    expect(fetchGroupData).toHaveBeenCalledTimes(1);
    expect(getValue().currentUserId).toBeNull();
    expect(getValue().group).toBeNull();

    // The mount-once fetchAll() above ran before sign-in; the resubscribe
    // effect binds `onAuthStateChange` asynchronously (behind its own
    // getStoredServer()/getSupabaseClient() calls), so wait for it before
    // firing the SIGNED_IN event.
    await waitUntil(() => authStateCallback !== undefined);

    await act(async () => {
      authStateCallback?.('SIGNED_IN');
    });
    await waitUntil(() => fetchGroupData.mock.calls.length >= 2);

    expect(getValue().currentUserId).toBe('user-1');
    expect(getValue().group).toEqual(postSignInGroup);
  });
});
