// HOUP-238: manual counterpart to the silent ON_LOAD auto-update
// (checkAutomatically: 'ON_LOAD' in app.config.ts) — surfaces version/bundle
// state and lets the user trigger check/download/restart on demand instead
// of only ever picking up updates silently on cold launch.
import * as React from 'react';
import { Linking, View } from 'react-native';
import * as Updates from 'expo-updates';
import * as Application from 'expo-application';
import { useRouter } from 'expo-router';
import { Download, Info, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react-native';
import { Text, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing, Button } from '@homeup/ui';
import {
  appStanding,
  appStandingLabel,
  appUpdateNotice,
  serverVersionLabel,
  timeAgo,
  useModules,
  useServerRelease,
  useWhatsNewHistory,
} from '@homeup/core';
import { WhatsNewGroups } from '@/components/whats-new/whats-new-list';
import { buildCommit } from '@/lib/build-info';
import { useDataCache } from '@/lib/data-cache';
import { ServerUpdatePanel } from './server-update';
import { SettingsInset, SettingsPanel } from './settings-panel';

/** A label/value line with an optional status under the label (T3: versions in tabular type). */
function InfoRow({ label, value, status }: { label: string; value: string; status?: string | null }) {
  return (
    <ListItem className="min-h-12 items-center px-3.5 py-2.5">
      <ListItemContent>
        <ListItemTitle>{label}</ListItemTitle>
        {status && (
          <ListItemMeta>
            <Text className="text-caption text-muted-foreground">{status}</Text>
          </ListItemMeta>
        )}
      </ListItemContent>
      <ListItemTrailing className="mt-0">
        <Text numberOfLines={1} className="text-caption tabular-nums text-muted-foreground">
          {value}
        </Text>
      </ListItemTrailing>
    </ListItem>
  );
}

type CheckState = 'idle' | 'checking' | 'no-update' | 'error';

/** Every What's new entry this person has the feature for (whats-new/README.md), by release. */
function WhatsNewHistory() {
  const router = useRouter();
  const { userSettings } = useDataCache();
  const view = useWhatsNewHistory({ platform: 'mobile', hidden: userSettings?.hidden_sections });
  if (view.total === 0) return null;
  return (
    <SettingsPanel icon={Sparkles} title="What's new">
      <WhatsNewGroups view={view} alwaysHeaders onOpen={(href) => router.push(href as never)} />
    </SettingsPanel>
  );
}

/** A newer APK, or one the server needs: what it is and where to get it (core app-release.ts). */
function NewAppVersion() {
  const release = useServerRelease();
  const standing = appStanding(Updates.runtimeVersion, release);
  const notice = appUpdateNotice(standing);
  if (!notice || standing.kind === 'current' || standing.kind === 'unknown') return null;
  const url = standing.latest?.url;
  return (
    <SettingsPanel icon={Download} title={notice.title}>
      <Text className="text-body text-muted-foreground">{notice.description}</Text>
      {url && (
        <Button onPress={() => Linking.openURL(url).catch(() => {})} size="sm" className="self-start px-3">
          {standing.latest ? `Get Rooftap ${standing.latest.version}` : 'Get the app'}
        </Button>
      )}
    </SettingsPanel>
  );
}

export function AppUpdates() {
  const { currentlyRunning, isUpdatePending, isDownloading, downloadProgress } = Updates.useUpdates();
  const release = useServerRelease();
  const { schema, serverUpdateAdds } = useModules();
  const standingLabel = appStandingLabel(appStanding(Updates.runtimeVersion, release));
  const [checkState, setCheckState] = React.useState<CheckState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const version = Application.nativeApplicationVersion ?? '–';
  const build = Application.nativeBuildVersion ?? '–';
  // One fine-print line for the build details, so the card stays two rows.
  // The commit answers "which merge am I running?"; the update id stands in
  // on bundles without one, and the channel shows only when it isn't the
  // usual production.
  const bundleAge = currentlyRunning.createdAt ? timeAgo(currentlyRunning.createdAt.toISOString()) : null;
  const commit = buildCommit();
  const details = [
    `Build ${Updates.runtimeVersion ?? '–'}`,
    currentlyRunning.isEmbeddedLaunch ? 'built in' : `updated${bundleAge ? ` ${bundleAge}` : ' over the air'}`,
    currentlyRunning.channel && currentlyRunning.channel !== 'production' ? currentlyRunning.channel : null,
    commit ?? currentlyRunning.updateId?.slice(0, 8) ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
  const serverStatus =
    serverUpdateAdds.length > 0
      ? `An update adds ${serverUpdateAdds.length} ${serverUpdateAdds.length === 1 ? 'feature' : 'features'}`
      : null;

  const check = React.useCallback(async () => {
    setError(null);
    setCheckState('checking');
    setBusy(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setCheckState('no-update');
        return;
      }
      await Updates.fetchUpdateAsync();
      setCheckState('idle');
    } catch (err) {
      setCheckState('error');
      setError(err instanceof Error ? err.message : 'Could not check for updates. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const restart = React.useCallback(async () => {
    setError(null);
    try {
      await Updates.reloadAsync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restart to apply the update.');
    }
  }, []);

  return (
    <>
      <NewAppVersion />
      <ServerUpdatePanel />
      <SettingsPanel icon={Info} title="Version">
        <SettingsInset>
          <InfoRow label="App" value={`${version} (${build})`} status={standingLabel} />
          <InfoRow label="Server" value={serverVersionLabel(release, schema)} status={serverStatus} />
        </SettingsInset>
        {/* selectable: long-press copies the line for a bug report. */}
        <Text selectable className="px-1 text-data-fragment text-muted-foreground">
          {details}
        </Text>
      </SettingsPanel>

      <SettingsPanel icon={RefreshCw} title="Updates">
        {!Updates.isEnabled ? (
          <>
            <Text className="text-body text-muted-foreground">Updates are managed by Metro in development.</Text>
            <Button disabled size="sm" variant="outline" className="self-start px-3">
              <RefreshCw size={14} className="text-foreground" />
              <Text className="text-[0.8rem] font-medium text-foreground">Check for updates</Text>
            </Button>
          </>
        ) : isUpdatePending ? (
          <>
            <Text className="text-body text-foreground">An update is ready. Restart to apply it.</Text>
            <Button onPress={restart} size="sm" className="self-start px-3">
              Restart to apply
            </Button>
          </>
        ) : (
          <>
            <Button onPress={check} disabled={busy} size="sm" variant="outline" className="self-start px-3">
              <RefreshCw size={14} className="text-foreground" />
              <Text className="text-[0.8rem] font-medium tabular-nums text-foreground">
                {checkState === 'checking'
                  ? isDownloading
                    ? `Downloading… ${Math.round((downloadProgress ?? 0) * 100)}%`
                    : 'Checking…'
                  : 'Check for updates'}
              </Text>
            </Button>
            {checkState === 'no-update' && (
              <Text className="text-body text-muted-foreground">You&apos;re on the latest version.</Text>
            )}
          </>
        )}

        {error && (
          <View className="flex-row items-start gap-2">
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-destructive" />
            <Text className="flex-1 text-caption text-destructive">{error}</Text>
          </View>
        )}
      </SettingsPanel>

      <WhatsNewHistory />
    </>
  );
}
