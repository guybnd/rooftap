// Screen tests run the real screens on react-native-web in jsdom. Native
// modules have no web build that loads here, so each one is a harmless stub
// (stub-module.tsx); the few that screens read from get a real answer.
import { vi } from 'vitest';

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

// jsdom has no matchMedia; react-native-web reads it for reduced motion and the colour scheme.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

const stub = async (overrides?: Record<string, unknown>) => (await import('./stub-module')).stubModule(overrides);

vi.mock('react-native-reanimated', async () => (await import('./reanimated-stub')).reanimatedStub());
vi.mock('lucide-react-native', () => stub());
vi.mock('react-native-svg', () => stub());
vi.mock('react-native-gesture-handler', () => stub());
vi.mock('react-native-keyboard-controller', () => stub());
vi.mock('react-native-safe-area-context', () =>
  stub({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), useSafeAreaFrame: () => ({ x: 0, y: 0, width: 400, height: 800 }) }),
);
vi.mock('nativewind', () => stub({ useColorScheme: () => ({ colorScheme: 'light', setColorScheme: () => {} }), vars: () => ({}) }));
vi.mock('expo-router', () =>
  stub({
    useLocalSearchParams: () => ({}),
    useGlobalSearchParams: () => ({}),
    usePathname: () => '/',
    useSegments: () => [],
    useFocusEffect: () => {},
    useNavigation: () => ({ setOptions: () => {}, addListener: () => () => {} }),
  }),
);
vi.mock('@react-native-community/netinfo', () => stub());
vi.mock('expo-file-system/legacy', () => stub());
vi.mock('expo-secure-store', () => stub());
vi.mock('@shopify/flash-list', () => import('./flash-list-stub'));
vi.mock('expo-image', () => stub());
vi.mock('expo-image-picker', () => stub());
vi.mock('expo-updates', () => stub());
vi.mock('expo-sqlite/kv-store', () => stub());
vi.mock('expo-notifications', () => stub());
vi.mock('expo-document-picker', () => stub());
vi.mock('react-native-android-widget', () => stub());
vi.mock('expo-web-browser', () => stub());
vi.mock('react-native-worklets', () => stub());
vi.mock('expo-splash-screen', () => stub());
vi.mock('expo-share-intent', () => stub());
vi.mock('expo-crypto', () => stub());
vi.mock('expo-constants', () => stub());
vi.mock('expo-auth-session/build/QueryParams', () => stub());
vi.mock('expo-task-manager', () => stub());
vi.mock('expo-system-ui', () => stub());
vi.mock('expo-status-bar', () => stub());
vi.mock('expo-sharing', () => stub());
vi.mock('expo-linking', () => stub());
vi.mock('expo-keep-awake', () => stub());
vi.mock('expo-haptics', () => stub());
vi.mock('expo-font', () => stub());
vi.mock('expo-auth-session', () => stub());
vi.mock('expo-application', () => stub());
vi.mock('expo', () => stub());

// The app's own seams: the store environment, the Supabase client and the
// data cache, all read from screenState so each test picks its rows.
vi.mock('@/lib/legend/environment', async () => {
  const { configureStoreEnvironment } = await import('@homeup/core');
  const { screenState } = await import('./screen-state');
  const env = {
    get supabase() {
      return screenState.supabase;
    },
    getPersistConfig: () => ({}),
    isOnline: () => true,
    isForeground: () => true,
    subscribeReconnect: () => () => {},
    subscribeForeground: () => () => {},
    keyValue: { getItem: () => null, setItem: () => {} },
    randomUUID: () => globalThis.crypto.randomUUID(),
  };
  configureStoreEnvironment(env as never);
  return { nativeStoreEnvironment: env };
});
vi.mock('@/lib/supabase-client', async () => {
  const { screenState } = await import('./screen-state');
  const client = () => screenState.supabase;
  return {
    getSupabaseClient: client,
    getCurrentSupabaseClient: client,
    getBoundSupabaseClient: client,
    onSupabaseClientChange: () => () => {},
    hasStoredSession: async () => true,
    resetSupabaseClient: () => {},
    performFullReset: async () => {},
    signOut: async () => {},
  };
});
vi.mock('@/lib/data-cache', async () => {
  const { screenState, ME, OTHER } = await import('./screen-state');
  const memberProfiles = {
    [ME]: { email: 'me@example.test', name: 'Sam', avatar: null },
    [OTHER]: { email: 'alex@example.test', name: 'Alex', avatar: null },
  };
  const useDataCache = () => ({
    group: { id: screenState.groupId, name: 'Test home', owner_id: ME, created_at: '2026-01-01T00:00:00Z' },
    currentUserId: ME,
    userSettings: null,
    preliminaryScores: [],
    memberProfiles,
    groupMembers: [
      { group_id: screenState.groupId, user_id: ME, role: 'owner' },
      { group_id: screenState.groupId, user_id: OTHER, role: 'member' },
    ],
    isGroupOwner: true,
    pendingInvitations: [],
    sentInvitations: [],
    loading: screenState.loading,
    isOnline: true,
    error: null,
    refresh: async () => {},
    updateUserSettings: async () => {},
  });
  return { useDataCache, DataCacheProvider: ({ children }: { children: unknown }) => children };
});
