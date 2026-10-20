import type { SupabaseClient } from "@supabase/supabase-js";
import type { McpToolMeta } from "@/lib/mcp-tools";

export interface McpSettings {
  enabled: boolean;
  readOnly: boolean;
  allowedTools: string[] | null;
}

// Fail-safe default: reproduces today's behavior (server on, every tool
// exposed). Used both when the settings fetch errors and when a caller has
// no user_settings row yet (maybeSingle -> null data, no error) — an infra
// hiccup or a fresh account must never silently lock a PAT out.
const DEFAULT_SETTINGS: McpSettings = { enabled: true, readOnly: false, allowedTools: null };

export async function getMcpSettings(admin: SupabaseClient, userId: string): Promise<McpSettings> {
  const { data, error } = await admin
    .from("user_settings")
    .select("mcp_enabled, mcp_read_only, mcp_allowed_tools")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return DEFAULT_SETTINGS;

  return {
    enabled: data.mcp_enabled ?? true,
    readOnly: data.mcp_read_only ?? false,
    allowedTools: data.mcp_allowed_tools ?? null,
  };
}

// The single registration conjunction (HOUP-26 Key decisions): a tool is
// callable iff the server is enabled, AND it's allow-listed (or the
// allowlist is null/"all"), AND it's a read tool whenever read-only is on.
// Read-only and the allowlist intersect rather than one short-circuiting
// the other — read-only + an allowlist yields the allow-listed read tools.
export function toolAllowed(settings: McpSettings, tool: McpToolMeta): boolean {
  if (!settings.enabled) return false;
  if (settings.allowedTools !== null && !settings.allowedTools.includes(tool.name)) return false;
  if (settings.readOnly && tool.kind !== "read") return false;
  return true;
}
