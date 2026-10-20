import { createSupabaseClient } from "@homeup/core";

let client: ReturnType<typeof createSupabaseClient> | undefined;

// Thin web wrapper (HOUP-67): the browser-client construction + keepalive
// fetch logic now lives in `packages/core`'s injectable factory. This file
// just reads the env once and memoizes the singleton — a per-platform concern
// that stays here rather than in core.
export function createClient() {
  if (!client) {
    client = createSupabaseClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    });
  }
  return client;
}
