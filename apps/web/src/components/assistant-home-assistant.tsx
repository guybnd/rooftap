"use client";

// HOUP-449: Settings > Assistant > Home Assistant. Connects the assistant to
// the household's Home Assistant through its MCP Server integration, with a
// long-lived access token. Everyone sees whether it is connected; owners
// connect it, set what the assistant may do there (Read, Ask first, Act),
// switch single tools off, and disconnect. The token never comes back from
// the server, only its last four characters. One primary action (PC).
// Native twin: apps/mobile/src/features/settings/panels/assistant-home-assistant.tsx.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { HousePlug } from "lucide-react";
import {
  TRUST_OPTIONS,
  homeAssistantToolAllowed,
  homeAssistantToolLabel,
  useModules,
  type HomeAssistantStatus,
  type HomeAssistantToolInfo,
  type TrustLevel,
} from "@homeup/core";
import { assistantApi } from "@/lib/assistant-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsInset, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";

const SETUP_HELP =
  "In Home Assistant, add the Model Context Protocol Server integration, then make a long-lived access token on your profile page. The assistant sees what you expose to Assist.";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function AssistantHomeAssistant() {
  const modules = useModules();
  const supported = modules.server("assistant.home-assistant");
  const [status, setStatus] = useState<HomeAssistantStatus | null>(null);
  const [tools, setTools] = useState<HomeAssistantToolInfo[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    assistantApi.homeAssistant().then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    if (supported) load();
  }, [supported, load]);

  const connection = status?.connection ?? null;
  const owner = !!status?.isOwner;

  const loadTools = useCallback(async () => {
    try {
      setTools((await assistantApi.homeAssistantTools()).tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach Home Assistant.");
    }
  }, []);
  useEffect(() => {
    if (owner && connection && !tools) void loadTools();
  }, [owner, connection, tools, loadTools]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await assistantApi.saveHomeAssistant({ url, token: token || undefined });
      setStatus(res.status);
      if (res.tools) setTools(res.tools);
      setEditing(false);
      setToken("");
      toast.success(connection ? "Home Assistant updated" : "Home Assistant connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (patch: { trust?: TrustLevel; allowedTools?: string[] | null }) => {
    if (!status?.connection) return;
    const before = status;
    setStatus({ ...status, connection: { ...status.connection, ...patch } });
    try {
      setStatus((await assistantApi.saveHomeAssistant(patch)).status);
    } catch (err) {
      setStatus(before);
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    }
  };

  const toggleTool = (name: string, on: boolean) => {
    if (!connection || !tools) return;
    const current = tools.map((t) => t.name).filter((n) => homeAssistantToolAllowed(n, connection.allowedTools));
    const next = on ? [...new Set([...current, name])] : current.filter((n) => n !== name);
    void save({ allowedTools: next.length === tools.length ? null : next });
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await assistantApi.disconnectHomeAssistant();
      setStatus((s) => (s ? { ...s, connection: null } : s));
      setTools(null);
      toast.message("Home Assistant disconnected.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  };

  if (!supported || !status) return null;
  const showForm = owner && status.canStore && (!connection || editing);

  return (
    <SettingsPanel
      icon={HousePlug}
      title="Home Assistant"
      description={
        connection
          ? "The assistant can check and control the devices you expose to Assist. Home Assistant changes can't be undone from Rooftap."
          : owner
            ? SETUP_HELP
            : "An owner can connect Home Assistant so the assistant can check and control your home."
      }
    >
      <div className="space-y-3">
        {connection && (
          <SettingsInset>
            <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">Connected to {hostOf(connection.url)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">Token ending {connection.last4}</p>
              </div>
              {owner && !editing && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setUrl(connection.url);
                    setEditing(true);
                  }}
                >
                  Change
                </Button>
              )}
              {owner && (
                <Button variant="ghost" disabled={busy} onClick={() => void disconnect()}>
                  Disconnect
                </Button>
              )}
            </div>
            {owner && (
              <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2.5">
                <p className="min-w-0 flex-1 text-sm font-medium text-foreground">What it may do</p>
                <SegmentedControl<TrustLevel>
                  ariaLabel="Home Assistant access"
                  size="sm"
                  value={connection.trust}
                  options={TRUST_OPTIONS}
                  onChange={(trust) => void save({ trust })}
                />
              </div>
            )}
          </SettingsInset>
        )}

        {showForm && (
          <div className="space-y-2">
            <Input
              aria-label="Home Assistant address"
              placeholder="https://home.example.com"
              inputMode="url"
              autoComplete="off"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
            />
            <Input
              type="password"
              aria-label="Long-lived access token"
              placeholder={connection ? "New token (leave empty to keep the current one)" : "Long-lived access token"}
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={busy}
            />
            {connection && <p className="px-1 text-xs text-muted-foreground">{SETUP_HELP}</p>}
            <div className="flex gap-2">
              <Button disabled={busy || !url.trim() || (!connection && !token.trim())} onClick={() => void connect()}>
                {busy ? "Connecting…" : connection ? "Save" : "Connect"}
              </Button>
              {editing && (
                <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
        {owner && !status.canStore && !connection && (
          <p className="text-xs text-muted-foreground">This server isn&apos;t set up to store tokens yet (HOUSEHOLD_KEYS_SECRET).</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {owner && connection && tools && tools.length > 0 && (
          <div className="space-y-1.5">
            <p className="px-1 text-xs text-muted-foreground">Tools the assistant may use</p>
            <SettingsInset>
              {tools.map((t) => (
                <SettingsSwitchRow
                  key={t.name}
                  title={homeAssistantToolLabel(t.name)}
                  description={t.kind === "read" ? "Looks things up" : "Changes things in your home"}
                  checked={homeAssistantToolAllowed(t.name, connection.allowedTools)}
                  onChange={(on) => toggleTool(t.name, on)}
                />
              ))}
            </SettingsInset>
          </div>
        )}
      </div>
    </SettingsPanel>
  );
}
