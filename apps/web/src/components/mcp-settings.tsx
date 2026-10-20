"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import {
  SavingHint,
  SettingsCheckbox,
  SettingsInset,
  SettingsLabel,
  SettingsPanel,
  SettingsSwitchRow,
} from "@/components/settings-panel";
import { Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from "@/components/ui/list-item";
import { timeAgo } from "@homeup/core";
import { useModules } from "@homeup/core";
import { MCP_TOOLS, mcpToolsForModules, type McpToolMeta } from "@/lib/mcp-tools";

// The allowlist is saved over every tool, so a tool whose module is off keeps
// its checkbox state for when the module comes back; only the list shown follows
// the household's modules.
const ALL_TOOL_NAMES = MCP_TOOLS.map((t) => t.name);

/**
 * HOUP-26: MCP server on/off, read-only, and per-tool allowlist for the
 * caller's PAT-authenticated agent access (src/app/api/mcp/route.ts). Reads
 * from useDataCache().userSettings; persists via the upsert+refresh pattern
 * (household-settings.tsx). A checked-tool set of every MCP_TOOLS name maps
 * to allowed_tools=null ("all") on save, mirroring the null/empty semantics
 * defined in src/lib/mcp-settings.ts.
 */
export function McpSettings() {
  const { userSettings, refresh } = useDataCache();
  const [enabled, setEnabledState] = useState(true);
  const [readOnly, setReadOnlyState] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set(ALL_TOOL_NAMES));
  const [saving, setSaving] = useState(false);
  const modules = useModules();
  const shown = mcpToolsForModules(modules.enabled);
  const readTools = shown.filter((t) => t.kind === "read");
  const writeTools = shown.filter((t) => t.kind === "write");

  useEffect(() => {
    if (!userSettings) return;
    setEnabledState(userSettings.mcp_enabled ?? true);
    setReadOnlyState(userSettings.mcp_read_only ?? false);
    const allowed = userSettings.mcp_allowed_tools;
    setChecked(allowed == null ? new Set(ALL_TOOL_NAMES) : new Set(allowed));
  }, [userSettings]);

  const persist = useCallback(
    async (patch: {
      mcp_enabled?: boolean;
      mcp_read_only?: boolean;
      mcp_allowed_tools?: string[] | null;
    }) => {
      setSaving(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("user_settings")
          .upsert(
            { user_id: user.id, ...patch, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
        await refresh();
      }
      setSaving(false);
    },
    [refresh]
  );

  const toggleEnabled = useCallback(() => {
    const next = !enabled;
    setEnabledState(next);
    persist({ mcp_enabled: next });
  }, [enabled, persist]);

  const toggleReadOnly = useCallback(() => {
    const next = !readOnly;
    setReadOnlyState(next);
    persist({ mcp_read_only: next });
  }, [readOnly, persist]);

  const toggleTool = useCallback(
    (name: string) => {
      const next = new Set(checked);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      setChecked(next);
      const allChecked = ALL_TOOL_NAMES.every((n) => next.has(n));
      persist({ mcp_allowed_tools: allChecked ? null : ALL_TOOL_NAMES.filter((n) => next.has(n)) });
    },
    [checked, persist]
  );

  return (
    <SettingsPanel
      icon={Server}
      title="MCP server"
      description="What an outside agent using your API key can do through Rooftap's MCP server."
    >
      <SettingsInset>
        <SettingsSwitchRow title="Server" checked={enabled} onChange={toggleEnabled} />
        <SettingsSwitchRow
          title="Read-only"
          description="The agent can read, never create, update or delete."
          checked={readOnly}
          onChange={toggleReadOnly}
          disabled={!enabled}
        />
      </SettingsInset>

      <div className="space-y-1.5">
        <SettingsLabel>Allowed tools</SettingsLabel>
        {shown.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">
            No tools yet. Tasks, Calendar, Costs and Groceries each bring their own when switched on.
          </p>
        )}
        {readTools.length > 0 && (
          <ToolGroup
            label="Read"
            tools={readTools}
            checked={checked}
            disabled={!enabled}
            onToggle={toggleTool}
          />
        )}
        {writeTools.length > 0 && (
          <ToolGroup
            label="Write"
            tools={writeTools}
            checked={checked}
            disabled={!enabled || readOnly}
            onToggle={toggleTool}
          />
        )}
      </div>

      {/* Needs a server with MCP sign-in (core server-features.ts). */}
      {modules.server("mcp.connected-apps") && <ConnectedApps />}

      <SavingHint show={saving} />
    </SettingsPanel>
  );
}

interface Connection {
  id: string;
  clientName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

// Apps connected by signing in to Rooftap (MCP sign-in, lib/mcp-oauth.ts),
// with the address to give them. The bot API key panel covers key-based agents.
function ConnectedApps() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/oauth/connections");
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setConnections((await res.json()).connections);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load connected apps.");
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    load();
  }, [load]);

  const disconnect = useCallback(
    async (id: string) => {
      setError(null);
      const res = await fetch(`/api/oauth/connections?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) setError("Could not disconnect that app.");
      await load();
    },
    [load]
  );

  return (
    <div className="space-y-1.5">
      <SettingsLabel>Connected apps</SettingsLabel>
      <p className="px-1 text-xs text-muted-foreground">
        Apps like Claude can connect by signing in. Add this address as a custom connector:{" "}
        <code className="font-mono text-foreground">{origin}/api/mcp</code>
      </p>
      {connections && connections.length > 0 && (
        <SettingsInset>
          {connections.map((c) => (
            <ListItem key={c.id}>
              <ListItemContent>
                <ListItemTitle>{c.clientName}</ListItemTitle>
                {/* H6: one middle dot per line. */}
                <ListItemMeta>
                  Connected {timeAgo(c.createdAt)}
                  {" · "}
                  {c.lastUsedAt ? `last used ${timeAgo(c.lastUsedAt)}` : "never used"}
                </ListItemMeta>
              </ListItemContent>
              <ListItemTrailing>
                {/* E4: destructive is danger text, no fill. */}
                <Button
                  onClick={() => disconnect(c.id)}
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  Disconnect
                </Button>
              </ListItemTrailing>
            </ListItem>
          ))}
        </SettingsInset>
      )}
      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ToolGroup({
  label,
  tools,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  tools: McpToolMeta[];
  checked: Set<string>;
  disabled: boolean;
  onToggle: (name: string) => void;
}) {
  return (
    <SettingsInset role="group" aria-label={`${label} tools`} className="mt-2 divide-y-0 pb-1 first-of-type:mt-0">
      <p className="px-3.5 pb-0.5 pt-3 text-xs font-medium text-muted-foreground">{label}</p>
      {tools.map((tool) => (
        // Tool names stay in code type: they are the literal identifiers an
        // agent calls, not prose.
        <SettingsCheckbox
          key={tool.name}
          checked={checked.has(tool.name)}
          disabled={disabled}
          onChange={() => onToggle(tool.name)}
        >
          <code className="font-mono text-xs">{tool.name}</code>
        </SettingsCheckbox>
      ))}
    </SettingsInset>
  );
}
