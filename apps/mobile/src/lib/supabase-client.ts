// HOUP-69: native Supabase client binding. A singleton, re-bound whenever
// the resolved config changes (switching servers) — see `resetSupabaseClient`.
import { clearThreadCache, createNativeClient, hasPersistedSession } from '@homeup/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authStorageAdapter } from './secure-storage-adapter';
import { clearStoredServer, type PublicConfig } from './server-config';

let client: SupabaseClient | undefined;
let boundConfigKey: string | undefined;

// HOUP-177: notifies listeners whenever the bound client instance changes
// (a fresh bind or an unbind) — consumers that hold a subscription against
// the *previous* instance (e.g. useAuthGuard's onAuthStateChange listener)
// need a signal to re-subscribe against the new one, since a stale
// subscription on a discarded client silently never fires again. Deferred
// via queueMicrotask so a listener that itself calls getSupabaseClient()
// (re-priming) can't reenter notifyClientChange synchronously mid-dispatch.
const clientChangeListeners = new Set<() => void>();

export function onSupabaseClientChange(listener: () => void): () => void {
  clientChangeListeners.add(listener);
  return () => clientChangeListeners.delete(listener);
}

function notifyClientChange(): void {
  queueMicrotask(() => {
    clientChangeListeners.forEach((listener) => listener());
  });
}

export function getSupabaseClient(config: PublicConfig): SupabaseClient {
  const key = `${config.supabaseUrl}:${config.supabaseAnonKey}`;
  if (!client || boundConfigKey !== key) {
    client = createNativeClient({
      url: config.supabaseUrl,
      anonKey: config.supabaseAnonKey,
      storage: authStorageAdapter,
    });
    boundConfigKey = key;
    notifyClientChange();
  }
  return client;
}

// Cold-boot gate (app/index.tsx): is there a session on this device at all?
// Reads storage directly instead of awaiting auth.getSession(), which waits
// on the client's initialize() and so on a refresh round trip whenever the
// access token has expired (retried for up to 30s offline). A stored but
// revoked session is still caught: the refresh fails, supabase-js emits
// SIGNED_OUT, and useAuthGuard bounces to /login.
export function hasStoredSession(config: PublicConfig): Promise<boolean> {
  return hasPersistedSession(authStorageAdapter, config.supabaseUrl);
}

export function resetSupabaseClient(): void {
  client = undefined;
  boundConfigKey = undefined;
  notifyClientChange();
}

// HOUP-76: non-throwing counterpart to getCurrentSupabaseClient() — callers
// that may run before any server/session is chosen (e.g. an app-wide
// AppState listener mounted at the root layout) need to no-op rather than
// fail when nothing is bound yet.
export function getBoundSupabaseClient(): SupabaseClient | undefined {
  return client;
}

// HOUP-86: the native StoreEnvironment's `supabase` getter has no `config`
// to pass (the seam's contract is a bare getter) — it needs whichever client
// is already bound. `getSupabaseClient` is called with a resolved config
// early in the boot sequence (both `app/index.tsx`'s cold-boot gate and
// `DataCacheProvider`'s own fetch prime it), so by the time any group-scoped
// store reads the environment a client is normally already bound. Fails
// fast rather than silently returning undefined, same fail-fast contract as
// `getStoreEnvironment()` itself.
export function getCurrentSupabaseClient(): SupabaseClient {
  if (!client) {
    throw new Error('Native Supabase client not yet bound — getSupabaseClient(config) must run once (cold boot or DataCacheProvider) before any group activates.');
  }
  return client;
}

// Full local reset on a server switch (HOUP-69 AC): sign out of the
// *previous* origin's session, then wipe the stored server selection. Local
// data/sync-cache wiping beyond the auth session is coordinated with
// HOUP-70's sync engine, which doesn't exist on native yet — nothing else to
// wipe here today.
export async function performFullReset(previousConfig: PublicConfig | null): Promise<void> {
  if (previousConfig) {
    try {
      await getSupabaseClient(previousConfig).auth.signOut();
    } catch {
      // Best-effort — proceed with the local wipe regardless of network
      // state; a stale server-side session on the old origin is harmless
      // once nothing on-device points at it anymore.
    }
  }
  resetSupabaseClient();
  clearThreadCache();
  await clearStoredServer();
}

// HOUP-138: user-initiated sign-out (Settings screen). Same sign-out +
// unbind shape as performFullReset's server-switch path, but deliberately
// keeps the stored server selection — the next sign-in is against the same
// origin, so /login (not /server-picker) is the right landing screen.
export async function signOut(config: PublicConfig): Promise<void> {
  try {
    await getSupabaseClient(config).auth.signOut();
  } catch {
    // Best-effort — proceed with the local unbind regardless of network
    // state; a stale server-side session is harmless once no client on this
    // device points at it anymore.
  }
  resetSupabaseClient();
  clearThreadCache();
}
