import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { availableModules, parseModuleList, resolveEnabledModules, type ModuleId } from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveGroupId } from "@/lib/pat";

// Modules (.docs/modules.md, section 5): API routes and MCP tools for a module
// the server doesn't offer, or the household has switched off, answer 404.
// Server code resolves modules from the same inputs as the apps: the server's
// HOMEUP_MODULES and the household's group_modules rows.

/**
 * The household's enabled modules. If its switches can't be read, every
 * module the server offers counts as on, which is how these routes behaved
 * before modules existed; a user with no household gets the defaults.
 */
export async function getEnabledModules(admin: SupabaseClient, groupId: string | null): Promise<Set<ModuleId>> {
  const available = parseModuleList(process.env.HOMEUP_MODULES);
  if (!groupId) return resolveEnabledModules({ available, rows: [] });
  const { data, error } = await admin.from("group_modules").select("module_id, enabled").eq("group_id", groupId);
  if (error) {
    console.error("group_modules read failed; treating every module as on", error.message);
    return new Set(availableModules(available).map((m) => m.id));
  }
  return resolveEnabledModules({ available, rows: data ?? [] });
}

export function moduleNotFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * For a signed-in user's request: a 404 response when any of `modules` is off
 * for their household, else null to carry on.
 */
export async function requireModules(userId: string, ...modules: ModuleId[]): Promise<NextResponse | null> {
  const admin = createAdminClient();
  const enabled = await getEnabledModules(admin, await resolveGroupId(admin, userId));
  return modules.every((m) => enabled.has(m)) ? null : moduleNotFound();
}
