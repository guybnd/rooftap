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
