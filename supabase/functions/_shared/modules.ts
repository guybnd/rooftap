// Modules (.docs/modules.md): a household's enabled modules, for the notify-*
// and calendar-* edge functions. The rules live in module-rules.ts (the Deno twin of core);
// this file only loads the inputs: the server's HOMEUP_MODULES and the
// household's group_modules rows.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";
import { MODULE_DEFAULTS, parseModuleList, resolveEnabledModules } from "./module-rules.ts";

export { isGoogleCalendarPushEnabled, taskOpenHref, taskOwnerModule } from "./module-rules.ts";

/**
 * Returns a per-group lookup, cached for the lifetime of one invocation so a
 * daily run over many tasks reads each household's switches once. If the
 * switches can't be read, the household counts as having every offered module
 * on, which is how these functions behaved before modules existed.
 */
export type ModuleLookup = (groupId: string) => Promise<Set<string>>;

export function createModuleLookup(admin: SupabaseClient): ModuleLookup {
  const available = parseModuleList(Deno.env.get("HOMEUP_MODULES"));
  const cache = new Map<string, Promise<Set<string>>>();
  const load = async (groupId: string): Promise<Set<string>> => {
    const { data, error } = await admin
      .from("group_modules")
      .select("module_id, enabled")
      .eq("group_id", groupId);
    if (error) {
      console.error("group_modules read failed; treating every module as on", error.message ?? error);
      return new Set(MODULE_DEFAULTS.map((m) => m.id).filter((id) => !available || available.includes(id)));
    }
    return resolveEnabledModules({ available, rows: data ?? [] });
  };
  return (groupId: string) => {
    let hit = cache.get(groupId);
    if (!hit) {
      hit = load(groupId);
      cache.set(groupId, hit);
    }
    return hit;
  };
}
