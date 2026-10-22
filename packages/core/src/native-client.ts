import { createClient as createSupabaseJsClient, type SupabaseClient } from "@supabase/supabase-js";

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// Default chunk size stays comfortably under SecureStore's ~2KB per-value
// limit, leaving headroom for the manifest/index bookkeeping.
const DEFAULT_CHUNK_SIZE = 1800;

// HOUP-69: wraps a size-limited key/value adapter (e.g. expo-secure-store)
// so it can hold values larger than its per-key cap — a Supabase auth
// session (access + refresh token + user metadata) is regularly well over
// 2KB. Splits a value into indexed chunks under a small manifest key; reads
// stitch the chunks back together. A plain adapter with no size limit works
// fine wrapped too (chunk count is just 1).
export function createChunkedStorage(adapter: StorageAdapter, chunkSize = DEFAULT_CHUNK_SIZE): StorageAdapter {
  const manifestKey = (key: string) => `${key}.chunks`;
  const chunkKey = (key: string, index: number) => `${key}.${index}`;

  return {
    async getItem(key) {
      const countRaw = await adapter.getItem(manifestKey(key));
      if (countRaw === null) return null;
      const count = Number(countRaw);
      if (!Number.isInteger(count) || count <= 0) return null;

      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await adapter.getItem(chunkKey(key, i));
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join("");
    },

    async setItem(key, value) {
      const previousCountRaw = await adapter.getItem(manifestKey(key));
      const previousCount = previousCountRaw ? Number(previousCountRaw) : 0;

      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += chunkSize) {
        chunks.push(value.slice(i, i + chunkSize));
      }
      // A value can be empty (zero chunks) — still write one empty chunk so
      // getItem's manifest-driven read can distinguish "empty string" from
      // "never written".
      if (chunks.length === 0) chunks.push("");

      for (let i = 0; i < chunks.length; i++) {
        await adapter.setItem(chunkKey(key, i), chunks[i]);
      }
      for (let i = chunks.length; i < previousCount; i++) {
        await adapter.removeItem(chunkKey(key, i));
      }
      await adapter.setItem(manifestKey(key), String(chunks.length));
    },

    async removeItem(key) {
      const countRaw = await adapter.getItem(manifestKey(key));
      const count = countRaw ? Number(countRaw) : 0;
      for (let i = 0; i < count; i++) {
        await adapter.removeItem(chunkKey(key, i));
      }
      await adapter.removeItem(manifestKey(key));
    },
  };
}

// Cold-boot fast path: supabase-js derives its session storage key from the
// project URL. Pinned explicitly in createNativeClient (identical to the
// default, so installed apps keep their stored sessions) and exported so the
// app can check for a persisted session without waiting on the client's own
// initialize(), which blocks on a token-refresh network call whenever the
// stored access token has expired, i.e. on nearly every cold launch.
export function nativeAuthStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

// True when `storage` holds a session supabase-js can recover from (it has a
// refresh token). Says nothing about whether that token is still valid; a
// revoked one surfaces later as a SIGNED_OUT auth event.
export async function hasPersistedSession(storage: StorageAdapter, supabaseUrl: string): Promise<boolean> {
  const raw = await storage.getItem(nativeAuthStorageKey(supabaseUrl));
  if (!raw) return false;
  try {
    const session: unknown = JSON.parse(raw);
    return (
      typeof session === "object" &&
      session !== null &&
      typeof (session as { refresh_token?: unknown }).refresh_token === "string"
    );
  } catch {
    return false;
  }
}

export interface CreateNativeClientOptions {
  url: string;
  anonKey: string;
  storage: StorageAdapter;
}

// HOUP-69: native (React Native / Expo) client factory. Unlike
// `createSupabaseClient` (createBrowserClient — cookie/localStorage-oriented,
// web-only), native has no document/cookies to persist a session in, so this
// binds a plain supabase-js client to an injected token-storage adapter and
// disables browser-only URL session detection (no location bar on native;
// the app parses OAuth redirect URLs itself via its deep-link handler).
export function createNativeClient({ url, anonKey, storage }: CreateNativeClientOptions): SupabaseClient {
  return createSupabaseJsClient(url, anonKey, {
    auth: {
      storage,
      storageKey: nativeAuthStorageKey(url),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // OAuth redirects carry a one-time code that only this device can
      // exchange (apps/mobile/src/lib/oauth-redirect.ts), never tokens.
      flowType: 'pkce',
    },
  });
}
