// HOUP-69: server-picker storage + validation. Pure normalize/validate logic
// lives in @homeup/core (`normalizeServerOrigin`, `isPublicConfig`) where it
// can be unit-tested with vitest; this file is the platform (SecureStore +
// fetch) glue around it.
import * as SecureStore from 'expo-secure-store';
import { isPublicConfig, normalizeServerOrigin, officialServerMove, type PublicConfig } from '@homeup/core';

export type { PublicConfig };

// The hosted Rooftap service. EXPO_PUBLIC_OFFICIAL_SERVER_URL (inlined by
// Expo's bundler at build/OTA time) overrides it, and setting it to an empty
// string builds an app with no Official option, leaving self-host only. Kept
// as a code default rather than build env so every APK and OTA gets it: the
// env var was never set in CI or eas.json, so the picker said "Official
// server unavailable" on every build.
const HOSTED_SERVER_URL = 'https://homeup.vercel.app';
// Emergency swap (.docs/server-swap.md): set this to the stand-in server's
// address and merge. The OTA then moves every phone on Official there
// (readStoredServer). Set it back to null to move them back.
const OFFICIAL_SERVER_STAND_IN: string | null = null;
const DEFAULT_OFFICIAL_SERVER_URL = OFFICIAL_SERVER_STAND_IN ?? HOSTED_SERVER_URL;
const officialOverride = process.env.EXPO_PUBLIC_OFFICIAL_SERVER_URL;
export const OFFICIAL_SERVER_URL: string | null =
  officialOverride === undefined ? DEFAULT_OFFICIAL_SERVER_URL : officialOverride.trim() || null;
export const OFFICIAL_SERVER_LABEL = 'Official';

// Every address Official has had. A phone stored on one of these before the
// OFFICIAL_KEY marker existed still follows Official (officialServerMove).
const KNOWN_OFFICIAL_URLS = [HOSTED_SERVER_URL];

const ORIGIN_KEY = 'homeup.serverOrigin';
const CONFIG_KEY = 'homeup.supabaseConfig';
// '1' when the person picked Official, so the phone follows Official when an
// OTA moves it to another server (emergency swap, .docs/server-swap.md).
const OFFICIAL_KEY = 'homeup.serverOfficial';

export interface ServerSelection {
  origin: string;
  isOfficial: boolean;
  config: PublicConfig;
}

// Fetches and validates GET <origin>/api/public-config. Throws a
// user-facing Error on network failure, non-2xx, or a response that isn't
// shaped like a Rooftap server's config (the phishing/SSRF guard: never trust
// an origin that doesn't answer this contract).
export async function fetchPublicConfig(origin: string, timeoutMs?: number): Promise<PublicConfig> {
  let response: Response;
  // AbortController + setTimeout, not AbortSignal.timeout, which React
  // Native's AbortSignal lacks.
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    response = await fetch(`${origin}/api/public-config`, { signal: controller?.signal });
  } catch {
    throw new Error("Couldn't reach that server. Check the address and try again.");
  } finally {
    if (timer) clearTimeout(timer);
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
  const [origin, configRaw, officialFlag] = await Promise.all([
    SecureStore.getItemAsync(ORIGIN_KEY),
    SecureStore.getItemAsync(CONFIG_KEY),
    SecureStore.getItemAsync(OFFICIAL_KEY),
  ]);
  if (!origin || !configRaw) return null;

  let config: PublicConfig;
  try {
    const parsed: unknown = JSON.parse(configRaw);
    if (!isPublicConfig(parsed)) return null;
    config = parsed;
  } catch {
    return null;
  }

  const moveTo = officialServerMove({
    storedOrigin: origin,
    pickedOfficial: officialFlag === '1',
    officialUrl: OFFICIAL_SERVER_URL,
    knownOfficialOrigins: KNOWN_OFFICIAL_URLS,
  });
  if (moveTo) {
    // Official moved. Switch once the new server answers; until then (offline,
    // new server not up yet) keep the old one and try again on the next start.
    // The new server has its own auth storage key, so the person signs in once.
    try {
      const moved = await fetchPublicConfig(moveTo, 4000);
      await writeServer(moveTo, moved);
      return { origin: moveTo, isOfficial: true, config: moved };
    } catch {
      return { origin, isOfficial: true, config };
    }
  }

  return { origin, isOfficial: isOfficialOrigin(origin), config };
}

async function writeServer(origin: string, config: PublicConfig): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ORIGIN_KEY, origin),
    SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(config)),
    isOfficialOrigin(origin)
      ? SecureStore.setItemAsync(OFFICIAL_KEY, '1')
      : SecureStore.deleteItemAsync(OFFICIAL_KEY),
  ]);
}

export async function storeServer(origin: string, config: PublicConfig): Promise<void> {
  storedServer = undefined;
  await writeServer(origin, config);
  storedServer = undefined;
}

export async function clearStoredServer(): Promise<void> {
  storedServer = undefined;
  await Promise.all([
    SecureStore.deleteItemAsync(ORIGIN_KEY),
    SecureStore.deleteItemAsync(CONFIG_KEY),
    SecureStore.deleteItemAsync(OFFICIAL_KEY),
  ]);
  storedServer = undefined;
}

export { normalizeServerOrigin };
