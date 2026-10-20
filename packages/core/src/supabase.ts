import { createBrowserClient } from "@supabase/ssr";
import { createClient as createServiceRoleClient, type SupabaseClient } from "@supabase/supabase-js";

// FLUX-263: mutations ride `keepalive` fetches so an in-flight write survives
// the page being frozen or unloaded (phone locked, tab backgrounded, mid-save
// navigation) instead of being aborted — the main way burst saves (recipe
// ingredients, checklist items) lost rows. Browsers cap total in-flight
// keepalive bodies at ~64KB, so only small string bodies opt in; oversized or
// non-string bodies (e.g. storage uploads) keep a normal fetch. An over-quota
// keepalive fetch rejects like a network error, which the sync layer retries.
const KEEPALIVE_BODY_MAX = 32_000;

const fetchWithKeepalive: typeof fetch = (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body;
  const smallBody =
    body === undefined || body === null || (typeof body === "string" && body.length <= KEEPALIVE_BODY_MAX);
  if (method !== "GET" && method !== "HEAD" && smallBody) {
    return fetch(input, { ...init, keepalive: true });
  }
  return fetch(input, init);
};

export interface CreateSupabaseClientOptions {
  url: string;
  anonKey: string;
}

// HOUP-67: injectable — takes url/anonKey as parameters instead of reading
// `NEXT_PUBLIC_*` env vars directly, so this factory works from any platform
// (web, and eventually the Expo app). Each platform's own thin wrapper reads
// its env once and calls this. Not memoized here — callers that want a
// singleton (apps/web's `createClient()`) own that caching themselves.
export function createSupabaseClient({ url, anonKey }: CreateSupabaseClientOptions) {
  return createBrowserClient(url, anonKey, { global: { fetch: fetchWithKeepalive } });
}

export interface CreateAdminClientOptions {
  url: string;
  serviceRoleKey: string;
}

// Service-role client for API routes that need to bypass RLS (e.g. the
// google_calendar_* tables, which carry zero client policies by design —
// FLUX-157). Never call this from client-bundled code — serviceRoleKey must
// only ever come from a server-only env var.
export function createAdminClient({ url, serviceRoleKey }: CreateAdminClientOptions): SupabaseClient {
  return createServiceRoleClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
