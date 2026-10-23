// HOUP-96: unit coverage for the pure, device-independent seam members of
// `nativeStoreEnvironment` (environment.ts). Native modules it touches at
// import time (NetInfo, AppState, expo-sqlite/kv-store's SQLiteStorage,
// expo-crypto, the Legend SQLite persist plugin, and the native Supabase
// client binding) are mocked below — no device/simulator needed.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const netInfoListeners = new Set<(state: { isConnected: boolean | null }) => void>();
const appStateListeners = new Set<(state: string) => void>();
let mockAppStateCurrent = 'active';

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: vi.fn((listener: (state: { isConnected: boolean | null }) => void) => {
      netInfoListeners.add(listener);
      return () => netInfoListeners.delete(listener);
    }),
  },
}));

vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mockAppStateCurrent;
    },
    addEventListener: vi.fn((_event: string, listener: (state: string) => void) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    }),
  },
}));

const sqliteData = new Map<string, string>();
vi.mock('expo-sqlite/kv-store', () => ({
  SQLiteStorage: class {
    getItemSync(key: string) {
      return sqliteData.get(key) ?? null;
    }
    setItemSync(key: string, value: string) {
      sqliteData.set(key, value);
    }
  },
}));

vi.mock('@legendapp/state/persist-plugins/expo-sqlite', () => ({
  observablePersistSqlite: vi.fn(() => ({ __plugin: 'sqlite' })),
}));

vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid'),
}));

vi.mock('../supabase-client', () => ({
  getCurrentSupabaseClient: vi.fn(() => ({ __client: 'mock-supabase' })),
}));

function fireNetInfo(isConnected: boolean | null) {
  for (const listener of netInfoListeners) listener({ isConnected });
}

function fireAppState(state: string) {
  mockAppStateCurrent = state;
  for (const listener of appStateListeners) listener(state);
}

describe('nativeStoreEnvironment', () => {
  // The first import of environment.ts transforms its whole dependency chain
  // (@homeup/core, supabase-js, Legend-State). On a busy CI runner that alone
  // can pass the 15 s test timeout, so pay it once here with its own budget;
  // later imports after vi.resetModules() reuse the transform cache.
  beforeAll(async () => {
    await import('./environment');
  }, 120_000);

  beforeEach(() => {
    vi.resetModules();
    netInfoListeners.clear();
    appStateListeners.clear();
    sqliteData.clear();
    mockAppStateCurrent = 'active';
  });

  it('getPersistConfig folds groupId into the persist name (HOUP-70 write-isolation boundary)', async () => {
    const { nativeStoreEnvironment } = await import('./environment');

    expect(nativeStoreEnvironment.getPersistConfig('household_tasks', 'group-a').name).toBe(
      'household_tasks__group-a'
    );
    expect(nativeStoreEnvironment.getPersistConfig('household_tasks', 'group-b').name).toBe(
      'household_tasks__group-b'
    );
  });

  it('keyValue.getItem/setItem round-trip synchronously against mocked SQLiteStorage', async () => {
    const { nativeStoreEnvironment } = await import('./environment');

    expect(nativeStoreEnvironment.keyValue.getItem('missing-key')).toBeNull();

    nativeStoreEnvironment.keyValue.setItem('sync-throttle', '12345');
    expect(nativeStoreEnvironment.keyValue.getItem('sync-throttle')).toBe('12345');
  });

  it('isOnline() reflects the most recent mocked NetInfo event', async () => {
    const { nativeStoreEnvironment } = await import('./environment');

    expect(nativeStoreEnvironment.isOnline()).toBe(true);

    fireNetInfo(false);
    expect(nativeStoreEnvironment.isOnline()).toBe(false);

    fireNetInfo(true);
    expect(nativeStoreEnvironment.isOnline()).toBe(true);

    // isConnected can be null (NetInfo still determining) — treated as offline.
    fireNetInfo(null);
    expect(nativeStoreEnvironment.isOnline()).toBe(false);
  });

  it('isForeground() reflects mocked AppState.currentState', async () => {
    const { nativeStoreEnvironment } = await import('./environment');

    expect(nativeStoreEnvironment.isForeground()).toBe(true);

    fireAppState('background');
    expect(nativeStoreEnvironment.isForeground()).toBe(false);

    fireAppState('active');
    expect(nativeStoreEnvironment.isForeground()).toBe(true);
  });

  it('randomUUID() delegates to expo-crypto', async () => {
    const { nativeStoreEnvironment } = await import('./environment');

    expect(nativeStoreEnvironment.randomUUID()).toBe('mock-uuid');
  });

  describe('subscribeReconnect', () => {
    it('calls sync() on a NetInfo reconnect event', async () => {
      const { nativeStoreEnvironment } = await import('./environment');
      const sync = vi.fn();
      nativeStoreEnvironment.subscribeReconnect(sync);

      fireNetInfo(false);
      expect(sync).not.toHaveBeenCalled();

      fireNetInfo(true);
      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('calls sync() on an AppState transition to active', async () => {
      const { nativeStoreEnvironment } = await import('./environment');
      const sync = vi.fn();
      nativeStoreEnvironment.subscribeReconnect(sync);

      fireAppState('background');
      expect(sync).not.toHaveBeenCalled();

      fireAppState('active');
      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('disposer tears down both the NetInfo and AppState listeners', async () => {
      const { nativeStoreEnvironment } = await import('./environment');
      const sync = vi.fn();
      const dispose = nativeStoreEnvironment.subscribeReconnect(sync);

      dispose();

      fireNetInfo(true);
      fireAppState('active');
      expect(sync).not.toHaveBeenCalled();
    });
  });

  describe('subscribeForeground', () => {
    it('routes an active AppState transition to onForeground', async () => {
      const { nativeStoreEnvironment } = await import('./environment');
      const onForeground = vi.fn();
      const onBackground = vi.fn();
      nativeStoreEnvironment.subscribeForeground(onForeground, onBackground);

      fireAppState('active');
      expect(onForeground).toHaveBeenCalledTimes(1);
      expect(onBackground).not.toHaveBeenCalled();
    });

    it('routes any non-active AppState transition to onBackground', async () => {
      const { nativeStoreEnvironment } = await import('./environment');
      const onForeground = vi.fn();
      const onBackground = vi.fn();
      nativeStoreEnvironment.subscribeForeground(onForeground, onBackground);

      fireAppState('background');
      expect(onBackground).toHaveBeenCalledTimes(1);

      fireAppState('inactive');
      expect(onBackground).toHaveBeenCalledTimes(2);
      expect(onForeground).not.toHaveBeenCalled();
    });

    it('disposer removes the AppState listener', async () => {
      const { nativeStoreEnvironment } = await import('./environment');
      const onForeground = vi.fn();
      const onBackground = vi.fn();
      const dispose = nativeStoreEnvironment.subscribeForeground(onForeground, onBackground);

      dispose();

      fireAppState('active');
      fireAppState('background');
      expect(onForeground).not.toHaveBeenCalled();
      expect(onBackground).not.toHaveBeenCalled();
    });
  });
});
