// HOUP-84: native port of apps/web/src/components/mcp-settings.tsx (HOUP-26)
// — MCP server on/off, read-only, and per-tool allowlist for the caller's
// PAT-authenticated agent access. Persists straight to the `user_settings`
// table via the mobile Supabase client (same upsert+onConflict:'user_id'
// pattern web uses, and the same pattern apps/mobile/src/app/(tabs)/costs/index.tsx
// already uses for other per-user settings) rather than going through a
// Next.js API route — both platforms converge on the one row, no new
// backend surface needed. Both platforms use the settings shell's Switch rows
// and the app's own checkbox rows (settings-panel.tsx). MCP_TOOLS comes from
// @homeup/core, the same list web's panel and the MCP route use.
import * as React from 'react';
import { View } from 'react-native';
import { Server } from 'lucide-react-native';
import {
  Button,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Text,
  haptics,
} from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';
import { getStoredServer } from '@/lib/server-config';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { MCP_TOOLS, mcpToolsForModules, timeAgo, useModules, type McpToolMeta } from '@homeup/core';
import {
  SavingHint,
  SettingsCheckbox,
  SettingsInset,
  SettingsLabel,
  SettingsPanel,
  SettingsSwitchRow,
} from './settings-panel';

// The allowlist is saved over every tool, so a tool whose module is off keeps
// its checkbox state for when the module comes back; only the list shown follows
// the household's modules.
const ALL_TOOL_NAMES = MCP_TOOLS.map((t) => t.name);

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
  // One inset fill per group, no hairlines between the checkbox rows.
  return (
    <View className="overflow-hidden rounded-xl bg-muted/30 pb-1" accessibilityLabel={`${label} tools`}>
      <Text className="px-3.5 pb-0.5 pt-3 text-xs font-medium text-muted-foreground">{label}</Text>
      {tools.map((tool) => (
        // Tool names stay in code type: they are the literal identifiers an
        // agent calls, not prose.
        <SettingsCheckbox
          key={tool.name}
          checked={checked.has(tool.name)}
          disabled={disabled}
          onChange={() => onToggle(tool.name)}
        >
          <Text numberOfLines={1} className="font-mono text-xs text-foreground">
            {tool.name}
          </Text>
        </SettingsCheckbox>
      ))}
    </View>
  );
}

/**
 * HOUP-26 port: MCP server on/off, read-only, and per-tool allowlist for the
 * caller's PAT-authenticated agent access. Reads from useDataCache().userSettings;
 * persists via a direct upsert+refresh to `user_settings`. A checked-tool set of
 * every MCP_TOOLS name maps to allowed_tools=null ("all") on save, mirroring the
 * null/empty semantics defined web-side in src/lib/mcp-settings.ts.
 */
export function McpSettings() {
  const { userSettings, refresh } = useDataCache();
  const [enabled, setEnabledState] = React.useState(true);
  const [readOnly, setReadOnlyState] = React.useState(false);
  const [checked, setChecked] = React.useState<Set<string>>(new Set(ALL_TOOL_NAMES));
  const [saving, setSaving] = React.useState(false);
  const modules = useModules();
  const shown = mcpToolsForModules(modules.enabled);
  const readTools = shown.filter((t) => t.kind === 'read');
  const writeTools = shown.filter((t) => t.kind === 'write');

  React.useEffect(() => {
    if (!userSettings) return;
    setEnabledState(userSettings.mcp_enabled ?? true);
    setReadOnlyState(userSettings.mcp_read_only ?? false);
    const allowed = userSettings.mcp_allowed_tools;
    setChecked(allowed == null ? new Set(ALL_TOOL_NAMES) : new Set(allowed));
  }, [userSettings]);

  const persist = React.useCallback(
    async (patch: { mcp_enabled?: boolean; mcp_read_only?: boolean; mcp_allowed_tools?: string[] | null }) => {
      setSaving(true);
      try {
        const supabase = getCurrentSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await supabase
            .from('user_settings')
            .upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
          await refresh();
        }
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  const toggleEnabled = React.useCallback(() => {
    const next = !enabled;
    setEnabledState(next);
    persist({ mcp_enabled: next });
  }, [enabled, persist]);

  const toggleReadOnly = React.useCallback(() => {
    const next = !readOnly;
    setReadOnlyState(next);
    persist({ mcp_read_only: next });
  }, [readOnly, persist]);

  const toggleTool = React.useCallback(
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

      <View className="gap-2">
        <SettingsLabel>Allowed tools</SettingsLabel>
        {shown.length === 0 && (
          <Text className="px-1 text-caption text-muted-foreground">
            No tools yet. Tasks, Calendar, Costs and Groceries each bring their own when switched on.
          </Text>
        )}
        {readTools.length > 0 && (
          <ToolGroup label="Read" tools={readTools} checked={checked} disabled={!enabled} onToggle={toggleTool} />
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
      </View>

      {/* Needs a server with MCP sign-in (core server-features.ts). */}
      {modules.server('mcp.connected-apps') && <ConnectedApps />}

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

// Same session-bearer pattern as pat-settings.tsx's patRequest.
async function connectionsRequest(method: 'GET' | 'DELETE', id?: string): Promise<{ res: Response; origin: string }> {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');
  const {
    data: { session },
  } = await getCurrentSupabaseClient().auth.getSession();
  if (!session) throw new Error('Not signed in.');
  const query = id ? `?id=${encodeURIComponent(id)}` : '';
  const res = await fetch(`${server.origin}/api/oauth/connections${query}`, {
    method,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  return { res, origin: server.origin };
}

// Port of web's ConnectedApps (components/mcp-settings.tsx): apps connected
// by signing in to Rooftap, with the address to give them.
function ConnectedApps() {
  const [connections, setConnections] = React.useState<Connection[] | null>(null);
  const [origin, setOrigin] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const { res, origin: serverOrigin } = await connectionsRequest('GET');
      setOrigin(serverOrigin);
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setConnections((await res.json()).connections);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load connected apps.');
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const disconnect = React.useCallback(
    async (id: string) => {
      setError(null);
      try {
        const { res } = await connectionsRequest('DELETE', id);
        if (!res.ok) throw new Error();
        haptics.warn();
      } catch {
        setError('Could not disconnect that app.');
      }
      await load();
    },
    [load]
  );

  return (
    <View className="gap-2">
      <SettingsLabel>Connected apps</SettingsLabel>
      <Text className="px-1 text-caption text-muted-foreground">
        Apps like Claude can connect by signing in. Add this address as a custom connector:{' '}
        <Text selectable className="font-mono text-caption text-foreground">
          {origin}/api/mcp
        </Text>
      </Text>
      {connections && connections.length > 0 && (
        <SettingsInset>
          {connections.map((c) => (
            <ListItem key={c.id}>
              <ListItemContent>
                <ListItemTitle>{c.clientName}</ListItemTitle>
                <ListItemMeta>
                  {/* H6: one middle dot per line. */}
                  <Text numberOfLines={1} className="text-caption text-muted-foreground">
                    Connected {timeAgo(c.createdAt)}
                    {' · '}
                    {c.lastUsedAt ? `last used ${timeAgo(c.lastUsedAt)}` : 'never used'}
                  </Text>
                </ListItemMeta>
              </ListItemContent>
              <ListItemTrailing className="mt-0">
                {/* E4: destructive is danger text, no fill. */}
                <Button size="sm" variant="ghost" onPress={() => disconnect(c.id)} textClassName="text-destructive">
                  Disconnect
                </Button>
              </ListItemTrailing>
            </ListItem>
          ))}
        </SettingsInset>
      )}
      {error && <Text className="px-1 text-caption text-destructive">{error}</Text>}
    </View>
  );
}
