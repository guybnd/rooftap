// HOUP-449: Settings > Assistant > Home Assistant. Connects the assistant to
// the household's Home Assistant through its MCP Server integration, with a
// long-lived access token. Everyone sees whether it is connected; owners
// connect it, set what the assistant may do there (Read, Ask first, Act),
// switch single tools off, and disconnect. The token never comes back from
// the server, only its last four characters. One primary action (PC).
// Web twin: apps/web/src/components/assistant-home-assistant.tsx.
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { HousePlug } from 'lucide-react-native';
import { Button, Input, SegmentedControl, Text, toast } from '@homeup/ui';
import {
  TRUST_OPTIONS,
  homeAssistantToolAllowed,
  homeAssistantToolLabel,
  useModules,
  type HomeAssistantStatus,
  type HomeAssistantToolInfo,
  type TrustLevel,
} from '@homeup/core';
import { assistantApi } from '@/features/assistant/assistant-api';
import { SettingsInset, SettingsPanel, SettingsSwitchRow } from './settings-panel';

const SETUP_HELP =
  'In Home Assistant, add the Model Context Protocol Server integration, then make a long-lived access token on your profile page. The assistant sees what you expose to Assist.';

function hostOf(url: string): string {
  const match = /^[a-z]+:\/\/([^/]+)/i.exec(url);
  return match ? match[1] : url;
}

export function AssistantHomeAssistant() {
  const modules = useModules();
  const supported = modules.server('assistant.home-assistant');
  const [status, setStatus] = useState<HomeAssistantStatus | null>(null);
  const [tools, setTools] = useState<HomeAssistantToolInfo[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
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
      setToken('');
      toast.success(connection ? 'Home Assistant updated' : 'Home Assistant connected');
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
      toast.error(err instanceof Error ? err.message : 'Could not save that.');
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
      toast.message('Home Assistant disconnected.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disconnect.');
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
            : 'An owner can connect Home Assistant so the assistant can check and control your home.'
      }
    >
      <View className="gap-3">
        {connection && (
          <SettingsInset>
            <View className="min-h-[52px] flex-row items-center gap-2 px-3.5 py-2.5">
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                  Connected to {hostOf(connection.url)}
                </Text>
                <Text className="mt-0.5 text-xs text-muted-foreground">Token ending {connection.last4}</Text>
              </View>
              {owner && !editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  className="h-11"
                  onPress={() => {
                    setUrl(connection.url);
                    setEditing(true);
                  }}
                >
                  <Text className="text-sm font-medium text-foreground">Change</Text>
                </Button>
              )}
              {owner && (
                <Button variant="ghost" size="sm" disabled={busy} className="h-11" onPress={() => void disconnect()}>
                  <Text className="text-sm font-medium text-foreground">Disconnect</Text>
                </Button>
              )}
            </View>
            {owner && (
              <View className="gap-2 px-3.5 py-3">
                <Text className="text-sm font-medium text-foreground">What it may do</Text>
                <SegmentedControl<TrustLevel>
                  accessibilityLabel="Home Assistant access"
                  value={connection.trust}
                  options={TRUST_OPTIONS}
                  onChange={(trust) => void save({ trust })}
                />
              </View>
            )}
          </SettingsInset>
        )}

        {showForm && (
          <View className="gap-2">
            <Input
              accessibilityLabel="Home Assistant address"
              placeholder="https://home.example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={url}
              onChangeText={setUrl}
              editable={!busy}
              className="h-11"
            />
            <Input
              accessibilityLabel="Long-lived access token"
              placeholder={connection ? 'New token (empty keeps the current one)' : 'Long-lived access token'}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              value={token}
              onChangeText={setToken}
              editable={!busy}
              className="h-11"
            />
            {connection && <Text className="px-1 text-xs text-muted-foreground">{SETUP_HELP}</Text>}
            <View className="flex-row gap-2">
              <Button
                disabled={busy || !url.trim() || (!connection && !token.trim())}
                onPress={() => void connect()}
                className="h-11 self-start px-3.5"
              >
                <Text className="text-sm font-medium text-primary-foreground">{busy ? 'Connecting…' : connection ? 'Save' : 'Connect'}</Text>
              </Button>
              {editing && (
                <Button variant="ghost" disabled={busy} onPress={() => setEditing(false)} className="h-11 px-3.5">
                  <Text className="text-sm font-medium text-foreground">Cancel</Text>
                </Button>
              )}
            </View>
          </View>
        )}
        {owner && !status.canStore && !connection && (
          <Text className="text-xs text-muted-foreground">{"This server isn't set up to store tokens yet (HOUSEHOLD_KEYS_SECRET)."}</Text>
        )}
        {error && <Text className="text-xs text-destructive">{error}</Text>}

        {owner && connection && tools && tools.length > 0 && (
          <View className="gap-1.5">
            <Text className="px-1 text-xs text-muted-foreground">Tools the assistant may use</Text>
            <SettingsInset>
              {tools.map((t) => (
                <SettingsSwitchRow
                  key={t.name}
                  title={homeAssistantToolLabel(t.name)}
                  description={t.kind === 'read' ? 'Looks things up' : 'Changes things in your home'}
                  checked={homeAssistantToolAllowed(t.name, connection.allowedTools)}
                  onChange={(on) => toggleTool(t.name, on)}
                />
              ))}
            </SettingsInset>
          </View>
        )}
      </View>
    </SettingsPanel>
  );
}
