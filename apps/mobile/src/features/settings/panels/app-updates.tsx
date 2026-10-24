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
import { Text, ListItem, ListItemContent, ListItemTitle, ListItemTrailing, Button } from '@homeup/ui';
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
import { useDataCache } from '@/lib/data-cache';
import { SettingsInset, SettingsPanel } from './settings-panel';

/** A read-only label/value line (T3: ids and versions in tabular type). */
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <ListItem className="min-h-12 items-center px-3.5 py-2.5">
      <ListItemContent>
        <ListItemTitle>{label}</ListItemTitle>
      </ListItemContent>
      <ListItemTrailing className="mt-0">
        <Text
          numberOfLines={1}
          className={mono ? 'text-data-fragment text-muted-foreground' : 'text-caption tabular-nums text-muted-foreground'}
        >
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
  const bundleAge = currentlyRunning.createdAt ? timeAgo(currentlyRunning.createdAt.toISOString()) : null;
  const bundleLabel = currentlyRunning.isEmbeddedLaunch
    ? 'Built in'
    : `Over the air${bundleAge ? ` · ${bundleAge}` : ''}`;
  const channel = currentlyRunning.channel ?? '–';
  const updateId = currentlyRunning.updateId ? currentlyRunning.updateId.slice(0, 8) : '–';
  // The main-branch commit this bundle was built from, inlined by CI's OTA
  // publish step (.github/workflows/ci.yml), so the screen answers "which
  // merge am I running?" without cross-referencing EAS update ids. Absent on
  // local/factory builds.
  const commit = process.env.EXPO_PUBLIC_GIT_SHA?.slice(0, 7) ?? '–';

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
      <SettingsPanel icon={Info} title="Version">
        <SettingsInset>
          <InfoRow label="App version" value={`${version} (${build})`} />
          {standingLabel && <InfoRow label="App status" value={standingLabel} />}
          <InfoRow label="App build" value={Updates.runtimeVersion ?? '–'} />
          <InfoRow label="Server version" value={serverVersionLabel(release, schema)} />
          {serverUpdateAdds.length > 0 && (
            <InfoRow label="Server status" value={`An update adds ${serverUpdateAdds.length} ${serverUpdateAdds.length === 1 ? "feature" : "features"}`} />
          )}
          <InfoRow label="Bundle" value={bundleLabel} />
          <InfoRow label="Channel" value={channel} />
          <InfoRow label="Commit" value={commit} mono />
          <InfoRow label="Update ID" value={updateId} mono />
        </SettingsInset>
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
