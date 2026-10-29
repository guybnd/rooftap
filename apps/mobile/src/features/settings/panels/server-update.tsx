// A newer Rooftap release for this server, shown only to the people who run
// it (core app-release.ts, GET /api/server-update). With one-click updates on
// (scripts/updater/, core server-updater.ts) it has an Update button and
// follows the run; without them it shows the manual steps. The web twin is
// apps/web/src/components/server-update.tsx; the one-time toast lives in
// lib/use-update-toasts.ts.
import * as React from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { Server } from 'lucide-react-native';
import { Button, Text, cn, toast } from '@homeup/ui';
import {
  SERVER_UPDATER_INSTALL_COMMAND,
  SERVER_UPGRADE_COMMANDS,
  SERVER_UPGRADE_DOCS_URL,
  currentUpdaterStatus,
  refreshServerUpdate,
  serverUpdateNotice,
  serverUpdatePanelCopy,
  serverUpdatePanelKind,
  updaterStepRows,
  useServerUpdate,
  useServerUpdater,
  type UpdaterStepRow,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { fetchServerUpdate, startServerUpdate } from '../server-update-api';
import { SettingsPanel } from './settings-panel';

function Commands({ lines }: { lines: readonly string[] }) {
  return (
    <View className="rounded-lg bg-muted px-3 py-2">
      <Text selectable className="text-data-fragment text-foreground">
        {lines.join('\n')}
      </Text>
    </View>
  );
}

function Steps({ rows }: { rows: UpdaterStepRow[] }) {
  if (rows.length === 0) return null;
  return (
    <View className="gap-2">
      {rows.map((row) => (
        <View key={row.id} className="flex-row items-center gap-2.5">
          {row.state === 'run' ? (
            <ActivityIndicator size="small" accessibilityLabel="Running" />
          ) : (
            <View
              className={cn(
                'size-3.5 rounded-full border-2',
                row.state === 'done' && 'border-success bg-success',
                row.state === 'fail' && 'border-destructive bg-destructive',
                row.state === 'todo' && 'border-border',
              )}
            />
          )}
          <Text className={cn('text-body', row.state === 'todo' ? 'text-muted-foreground' : 'text-foreground')}>{row.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function ServerUpdatePanel() {
  const userId = useDataCache().currentUserId;
  const update = useServerUpdate(fetchServerUpdate, userId);
  const updater = useServerUpdater(fetchServerUpdate, userId);
  const [confirming, setConfirming] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const kind = serverUpdatePanelKind(update, updater);
  if (!kind) return null;
  const copy = serverUpdatePanelCopy(kind, update, updater);
  const status = currentUpdaterStatus(updater?.status ?? null);
  const latest = update?.latest;

  const start = async () => {
    if (!latest) return;
    setStarting(true);
    try {
      await startServerUpdate(latest);
      setConfirming(false);
      await refreshServerUpdate(fetchServerUpdate);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The server could not start the update.');
    } finally {
      setStarting(false);
    }
  };

  const whatChanged = update ? (
    <Button onPress={() => Linking.openURL(update.url).catch(() => {})} size="sm" variant="outline" className="px-3">
      <Text className="text-[0.8rem] font-medium text-foreground">What changed</Text>
    </Button>
  ) : null;

  if (kind === 'manual' && update) {
    const notice = serverUpdateNotice(update);
    return (
      <SettingsPanel icon={Server} title={notice.title} description={copy.subtitle}>
        <Text className="text-body text-muted-foreground">{copy.body}</Text>
        <Commands lines={[SERVER_UPDATER_INSTALL_COMMAND]} />
        <Text className="text-body text-muted-foreground">Or back up first, then update by hand:</Text>
        <Commands lines={SERVER_UPGRADE_COMMANDS} />
        <View className="flex-row flex-wrap gap-2">
          {whatChanged}
          <Button onPress={() => Linking.openURL(SERVER_UPGRADE_DOCS_URL).catch(() => {})} size="sm" variant="outline" className="px-3">
            <Text className="text-[0.8rem] font-medium text-foreground">Upgrade guide</Text>
          </Button>
        </View>
      </SettingsPanel>
    );
  }

  const canRetry = (kind === 'failed' || kind === 'rolled-back' || kind === 'stuck') && !!latest && !!updater?.installed;
  return (
    <SettingsPanel icon={Server} title={copy.title} description={copy.subtitle}>
      {kind === 'ready' && update && (
        <Text className="font-heading text-title tabular-nums text-foreground">
          {update.current} <Text className="text-body text-muted-foreground">to</Text> {update.latest}
        </Text>
      )}
      {kind === 'done' && status?.target && <Text className="font-heading text-title tabular-nums text-foreground">{status.target}</Text>}
      {(kind === 'running' || kind === 'failed' || kind === 'rolled-back') && <Steps rows={updaterStepRows(status, updater?.pending)} />}
      {copy.body && !confirming && <Text className="text-body text-muted-foreground">{copy.body}</Text>}
      {confirming && latest ? (
        <View className="gap-3 rounded-2xl bg-muted/60 p-3">
          <Text className="text-body font-medium text-foreground">Update the server to {latest}?</Text>
          <View className="gap-1">
            <Text className="text-body text-muted-foreground">Backs up the database and files first.</Text>
            <Text className="text-body text-muted-foreground">Everyone is offline for about a minute.</Text>
            <Text className="text-body text-muted-foreground">Goes back to {update?.current} and your data if anything fails.</Text>
          </View>
          <View className="gap-2">
            <Button onPress={start} disabled={starting}>
              {starting ? 'Starting' : 'Update now'}
            </Button>
            <Button onPress={() => setConfirming(false)} disabled={starting} variant="outline">
              <Text className="font-medium text-foreground">Not now</Text>
            </Button>
          </View>
        </View>
      ) : (
        (kind === 'ready' || canRetry) && (
          <View className="gap-2">
            {latest && (
              <Button onPress={() => setConfirming(true)}>{kind === 'ready' ? `Update to ${latest}` : 'Try again'}</Button>
            )}
            {whatChanged}
          </View>
        )
      )}
    </SettingsPanel>
  );
}
