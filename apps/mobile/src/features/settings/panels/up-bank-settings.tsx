// Up Bank connector: Settings > Connectors > Up Bank. Each person connects their own
// Up account with a personal access token from api.up.com.au, and chooses
// what the household sees: nothing, only their joint accounts, or everything. The token never comes back from
// the server, only its last four characters. Disconnecting removes every
// transaction read from Up. One primary action (PC).
// Web twin: apps/web/src/components/up-bank-settings.tsx.
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Landmark } from 'lucide-react-native';
import { Button, Input, Text, toast } from '@homeup/ui';
import { timeAgo, useModules, type BankShareMode, type UpBankStatus } from '@homeup/core';
import { upBankApi } from '@/features/costs/up-bank-api';
import { SettingsChoiceRow, SettingsInset, SettingsPanel, SettingsSwitchRow } from './settings-panel';

const SETUP_HELP =
  'Make a personal access token at api.up.com.au and paste it here. Rooftap reads your transactions and never moves money.';
const OLD_SERVER = 'Your Rooftap server needs an update before it can connect Up Bank.';
const NOT_ALLOWED =
  'Up allows its API for personal use only, so Up Bank works on self-hosted Rooftap servers, where your token stays on your own server.';

const SHARE_CHOICES: { mode: BankShareMode; title: string; description: string }[] = [
  { mode: 'joint', title: 'Share joint accounts', description: 'The household sees your 2Up accounts. Your own accounts stay under Mine.' },
  { mode: 'all', title: 'Share everything', description: 'The household sees all your Up accounts.' },
  { mode: 'none', title: 'Keep it to myself', description: 'Only you see your Up money.' },
];

export function UpBankSettings() {
  const modules = useModules();
  const supported = modules.server('connectors.up-bank');
  // Older servers only know on or off.
  const modes = modules.server('connectors.up-bank-sharing');
  const [status, setStatus] = useState<UpBankStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    upBankApi.status().then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    if (supported) load();
  }, [supported, load]);

  const connection = status?.connection ?? null;

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await upBankApi.save({ token }));
      setEditing(false);
      setToken('');
      toast.success(connection ? 'Up token updated' : 'Up connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect.");
    } finally {
      setBusy(false);
    }
  };

  const setShared = async (shared: boolean) => {
    if (!status?.connection) return;
    const before = status;
    setStatus({ ...status, connection: { ...status.connection, shared } });
    try {
      setStatus(await upBankApi.save({ shared }));
    } catch (err) {
      setStatus(before);
      toast.error(err instanceof Error ? err.message : 'Could not save that.');
    }
  };

  const setShareMode = async (shareMode: BankShareMode) => {
    if (!status?.connection) return;
    const before = status;
    setStatus({ ...status, connection: { ...status.connection, shareMode, shared: shareMode !== 'none' } });
    try {
      setStatus(await upBankApi.save({ shareMode }));
    } catch (err) {
      setStatus(before);
      toast.error(err instanceof Error ? err.message : 'Could not save that.');
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await upBankApi.disconnect();
      setStatus((s) => (s ? { ...s, connection: null } : s));
      toast.message('Up disconnected.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return <SettingsPanel icon={Landmark} title="Up Bank" description={OLD_SERVER} />;
  }
  if (!status) return null;
  const showForm = status.allowed && status.canStore && (!connection || editing);
  const synced = timeAgo(connection?.lastSyncedAt);

  return (
    <SettingsPanel
      icon={Landmark}
      title="Up Bank"
      description={
        !status.allowed
          ? NOT_ALLOWED
          : connection
            ? 'Your Up spending shows in Costs, and the assistant can answer questions about it. Disconnecting removes the transactions Rooftap read from Up.'
            : SETUP_HELP
      }
    >
      <View className="gap-3">
        {connection && (
          <SettingsInset>
            <View className="min-h-[52px] flex-row items-center gap-2 px-3.5 py-2.5">
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                  Connected
                </Text>
                <Text className="mt-0.5 text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  Token ending {connection.last4} · {connection.live ? 'live' : synced ? `read ${synced.toLowerCase()}` : 'not read yet'}
                </Text>
              </View>
              {status.allowed && !editing && (
                <Button variant="ghost" size="sm" disabled={busy} className="h-11" onPress={() => setEditing(true)}>
                  <Text className="text-sm font-medium text-foreground">Change</Text>
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={busy} className="h-11" onPress={() => void disconnect()}>
                <Text className="text-sm font-medium text-foreground">Disconnect</Text>
              </Button>
            </View>
            {modes ? (
              SHARE_CHOICES.map((c) => (
                <SettingsChoiceRow
                  key={c.mode}
                  selected={(connection.shareMode ?? (connection.shared ? 'all' : 'none')) === c.mode}
                  onSelect={() => void setShareMode(c.mode)}
                  title={c.title}
                  description={c.description}
                  disabled={!status.allowed}
                />
              ))
            ) : (
              <SettingsSwitchRow
                title="Share with the household"
                description="Others in your home see your spending, and the assistant can use it when they ask."
                checked={connection.shared}
                disabled={!status.allowed}
                onChange={(on) => void setShared(on)}
              />
            )}
          </SettingsInset>
        )}

        {showForm && (
          <View className="gap-2">
            <Input
              accessibilityLabel="Up personal access token"
              placeholder={connection ? 'New token' : 'up:yeah:…'}
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
              <Button disabled={busy || !token.trim()} onPress={() => void connect()} className="h-11 self-start px-3.5">
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
        {status.allowed && !status.canStore && !connection && (
          <Text className="text-xs text-muted-foreground">{"This server isn't set up to store tokens yet (HOUSEHOLD_KEYS_SECRET)."}</Text>
        )}
        {error && <Text className="text-xs text-destructive">{error}</Text>}
      </View>
    </SettingsPanel>
  );
}
