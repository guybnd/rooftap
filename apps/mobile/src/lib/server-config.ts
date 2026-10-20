// HOUP-69: server-picker storage + validation. Pure normalize/validate logic
// lives in @homeup/core (`normalizeServerOrigin`, `isPublicConfig`) where it
// can be unit-tested with vitest; this file is the platform (SecureStore +
// fetch) glue around it.
import * as SecureStore from 'expo-secure-store';
import { isPublicConfig, normalizeServerOrigin, type PublicConfig } from '@homeup/core';

export type { PublicConfig };

// No canonical "Official" server domain exists anywhere in this repo (web
// deploys to whatever Vercel project URL is configured at deploy time), so
// this deliberately does NOT hardcode a guess — it must be set at Expo build
// time. EXPO_PUBLIC_* vars are inlined by Expo's bundler automatically, no
// extra config needed. Until set, the picker's "Official" option is
// unavailable and self-host remains fully usable.
export const OFFICIAL_SERVER_URL: string | null = process.env.EXPO_PUBLIC_OFFICIAL_SERVER_URL ?? null;
export const OFFICIAL_SERVER_LABEL = 'Official';

const ORIGIN_KEY = 'homeup.serverOrigin';
const CONFIG_KEY = 'homeup.supabaseConfig';

export interface ServerSelection {
  origin: string;
  isOfficial: boolean;
  config: PublicConfig;
}

// Fetches and validates GET <origin>/api/public-config. Throws a
// user-facing Error on network failure, non-2xx, or a response that isn't
// shaped like a Rooftap server's config (the phishing/SSRF guard: never trust
// an origin that doesn't answer this contract).
export async function fetchPublicConfig(origin: string): Promise<PublicConfig> {
  let response: Response;
  try {
    response = await fetch(`${origin}/api/public-config`);
  } catch {
    throw new Error("Couldn't reach that server. Check the address and try again.");
  }

  if (!response.ok) {
    throw new Error("That server didn't respond as expected.");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("That doesn't look like a Rooftap server.");
  }

  if (!isPublicConfig(data)) {
    throw new Error("That doesn't look like a Rooftap server.");
  }

  return data;
}

export function isOfficialOrigin(origin: string): boolean {
  return OFFICIAL_SERVER_URL !== null && origin === normalizeServerOrigin(OFFICIAL_SERVER_URL);
}

// Cold-start fix: the root layout's hooks, DataCacheProvider and the index
// gate all call getStoredServer() during the same boot, and every call was
// two Android Keystore decrypts. Memoized for the process lifetime;
// storeServer/clearStoredServer are the only writers and reset it.
let storedServer: Promise<ServerSelection | null> | undefined;

export function getStoredServer(): Promise<ServerSelection | null> {
  if (!storedServer) {
    storedServer = readStoredServer();
    // A failed read must not stick; the next caller retries.
    storedServer.catch(() => {
      storedServer = undefined;
    });
  }
  return storedServer;
}

async function readStoredServer(): Promise<ServerSelection | null> {
  const [origin, configRaw] = await Promise.all([
    SecureStore.getItemAsync(ORIGIN_KEY),
    SecureStore.getItemAsync(CONFIG_KEY),
  ]);
  if (!origin || !configRaw) return null;

  try {
    const parsed: unknown = JSON.parse(configRaw);
    if (!isPublicConfig(parsed)) return null;
    return { origin, isOfficial: isOfficialOrigin(origin), config: parsed };
  } catch {
    return null;
  }
}

export async function storeServer(origin: string, config: PublicConfig): Promise<void> {
  storedServer = undefined;
  await Promise.all([
    SecureStore.setItemAsync(ORIGIN_KEY, origin),
    SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(config)),
  ]);
  storedServer = undefined;
}

export async function clearStoredServer(): Promise<void> {
  storedServer = undefined;
  await Promise.all([SecureStore.deleteItemAsync(ORIGIN_KEY), SecureStore.deleteItemAsync(CONFIG_KEY)]);
  storedServer = undefined;
}

export { normalizeServerOrigin };
