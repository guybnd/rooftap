export interface PublicConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /**
   * Modules this server offers (HOMEUP_MODULES, see .docs/modules.md).
   * null or absent = every module; absent on servers older than modules.
   */
  modules?: string[] | null;
  /**
   * The newest migration this server was built from (server-features.ts).
   * Absent on servers older than this field, which count as the 1.0.0 baseline.
   */
  schemaVersion?: string | null;
  /** The Rooftap release the server was built from (app-release.ts). Absent on older servers. */
  version?: string | null;
  /** The oldest phone runtime the server still serves. */
  minAppRuntime?: string | null;
  /** The newest phone release, with its runtime and page; null when there is none to offer. */
  latestApp?: { version: string; runtime: string; url: string } | null;
}

// HOUP-69: response-shape guard for GET /api/public-config — the native
// picker validates against this before trusting a user-entered self-host
// URL, so a non-Rooftap host that returns some other JSON body (or an HTML
// error page a naive `.json()` call chokes on upstream) is rejected instead
// of silently producing a broken client.
export function isPublicConfig(value: unknown): value is PublicConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).supabaseUrl === "string" &&
    (value as Record<string, unknown>).supabaseUrl !== "" &&
    typeof (value as Record<string, unknown>).supabaseAnonKey === "string" &&
    (value as Record<string, unknown>).supabaseAnonKey !== ""
  );
}

// HOUP-69: normalizes a user-entered self-host address into a bare origin
// (scheme + host, no path/query/trailing slash) before it's used as a fetch
// base or persisted — defaults a schemeless entry to https while preserving
// an explicit "http://" as-is (intentional, for LAN self-host), and strips
// everything but scheme+host so "example.com/foo?x=1" and
// "https://example.com/" both become "https://example.com". Throws with a
// user-facing message on empty or unparseable input.
export function normalizeServerOrigin(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a server address");
  }

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("That doesn't look like a valid server address");
  }

  if (!url.hostname) {
    throw new Error("That doesn't look like a valid server address");
  }

  return `${url.protocol}//${url.host}`;
}

// Emergency swap (.docs/server-swap.md): a phone that picked "Official"
// follows the Official address, so moving the hosted service to another
// server is one OTA that changes EXPO_PUBLIC_OFFICIAL_SERVER_URL, not a
// manual server change on every phone. Returns the origin the phone should
// move to, or null to stay. `pickedOfficial` is the stored marker; phones
// from before it existed count as Official when their origin is one of
// `knownOfficialOrigins` (the addresses Official has had). A server someone
// typed in themselves never moves.
export function officialServerMove(input: {
  storedOrigin: string;
  pickedOfficial: boolean;
  officialUrl: string | null;
  knownOfficialOrigins: readonly string[];
}): string | null {
  if (!input.officialUrl) return null;
  let official: string;
  try {
    official = normalizeServerOrigin(input.officialUrl);
  } catch {
    return null;
  }
  if (input.storedOrigin === official) return null;
  const wasOfficial =
    input.pickedOfficial ||
    input.knownOfficialOrigins.some((url) => {
      try {
        return normalizeServerOrigin(url) === input.storedOrigin;
      } catch {
        return false;
      }
    });
  return wasOfficial ? official : null;
}
