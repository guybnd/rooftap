import { createAdminClient as createCoreAdminClient } from "@homeup/core";
import type { SupabaseClient } from "@supabase/supabase-js";

// Thin web wrapper (HOUP-67): construction lives in `packages/core`'s
// injectable factory; this just reads the service-role env var. Mirrors the
// inline adminClient() in src/app/api/push/subscribe/route.ts; centralized
// here once several routes need the same client.
export function createAdminClient(): SupabaseClient {
  return createCoreAdminClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  });
}
