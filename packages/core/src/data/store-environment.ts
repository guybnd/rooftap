// HOUP-73: the platform-injection seam for the Legend-State data layer.
//
// packages/core is consumed by both apps/web (webpack, doesn't resolve Metro's
// .native.ts/.web.ts convention) and apps/mobile (Metro) — and, decisively, a
// browser-coupled file inside core would violate HOUP-67's zero-browser-globals
// boundary regardless of bundler. So platform coupling (IndexedDB/expo-sqlite
// persistence, online/visibility detection, key-value storage, the Supabase
// client) is injected at runtime instead of split across platform files: each
// app registers its own StoreEnvironment once at startup, and every store
// factory/hook in this package reads it via getStoreEnvironment() instead of
// touching a browser or RN global directly.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface StoreEnvironment {
  /** Shared client for synced reads/writes and the realtime watchdog channel. */
  supabase: SupabaseClient;
  /**
   * Builds the `persist` block passed to `syncedSupabase`'s observable — e.g.
   * `{ name: storageName, plugin, retrySync: true, indexedDB: { prefixID: groupId } }`
   * on web. `groupId`-keyed so two groups' local caches never share one table
   * (the HOUP-70 group-scoping fix).
   */
  getPersistConfig(storageName: string, groupId: string): Record<string, unknown>;
  /** Replaces `navigator.onLine` in the write-path `onError` guard. */
  isOnline(): boolean;
  /** Replaces `document.visibilityState === 'visible'`. */
  isForeground(): boolean;
  /**
   * Subscribes `sync` to both "back online" and "returned to foreground"
   * triggers. Replaces `useReconnectSync`'s `window 'online'` +
   * `document 'visibilitychange' -> visible` listeners.
   */
  subscribeReconnect(sync: () => void): () => void;
  /**
   * Subscribes to foreground/background transitions for the fallback-sync
   * timer's start/stop. Replaces `acquireSyncCoordinator`'s visibilitychange
   * start/stop wiring.
   */
  subscribeForeground(onForeground: () => void, onBackground: () => void): () => void;
  /** Replaces `window.localStorage` in the reset-sync throttle. */
  keyValue: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
  /**
   * Native-safe UUID generation (HOUP-93). Replaces the browser-only
   * `crypto.randomUUID` global, which is `undefined` on React Native/Hermes.
   */
  randomUUID(): string;
}

let current: StoreEnvironment | null = null;

/** Call once per app at startup, before any store is used. */
export function configureStoreEnvironment(env: StoreEnvironment): void {
  current = env;
}

/**
 * Fails fast rather than silently no-syncing: a store used before its
 * platform's environment is registered is a wiring bug, not a runtime state
 * to degrade gracefully from.
 */
export function getStoreEnvironment(): StoreEnvironment {
  if (!current) {
    throw new Error("Legend StoreEnvironment not configured — call configureStoreEnvironment() before any store use.");
  }
  return current;
}

/**
 * Platform-safe UUID for core's id-generation call sites. Prefers the
 * configured environment (native MUST configure — Hermes has no global
 * crypto). Falls back to the host runtime's own randomUUID where one exists
 * (browsers, Node in unit tests) so pure-logic helpers don't demand a full
 * StoreEnvironment just to mint an id.
 */
export function envRandomUUID(): string {
  if (current) return current.randomUUID();
  const hostCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (hostCrypto?.randomUUID) return hostCrypto.randomUUID();
  throw new Error('No StoreEnvironment configured and no host randomUUID — configure the environment first (required on React Native).');
}
