// HOUP-138: Hearth-styled fallback for expo-router's per-route ErrorBoundary
// convention (a route file's named `ErrorBoundary` export, `{ error, retry }`
// props — see node_modules/expo-router/build/views/Try.d.ts). The root
// layout exports one below so a render throw anywhere in the tree shows this
// instead of a raw native crash.
//
// A broken screen is usually a bad over-the-air update, and the fix ships the
// same way, so the screen's main action fetches and applies the newest update
// in place instead of leaving it to a cold restart.
//
// The screen also reports the crash on its own (core crash-report.ts,
// lib/crash-reports.ts), unless this phone switched that off in Settings >
// About & updates. "Show details" shows exactly what was sent; with reports
// off, a button there sends it by hand.
import * as React from 'react';
import { ScrollView, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import { ChevronDown, ChevronUp, Download, RotateCcw } from 'lucide-react-native';
import {
  DEFAULT_THEME_PREFERENCE,
  buildCrashReport,
  crashReceiptNote,
  crashReportLines,
  reportCrash,
  resolveThemePreference,
  type CrashOutcome,
} from '@homeup/core';
import { Text, Button, ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing, ThemeProvider } from '@homeup/ui';
import { RooftapTile } from '@/components/brand/rooftap-mark';
import { crashContext, sendCrash } from '@/lib/crash-reports';

type FixState = 'idle' | 'checking' | 'downloading' | 'restarting' | 'latest' | 'offline';

const FIX_LABEL: Record<FixState, string> = {
  idle: 'Get the fix',
  checking: 'Checking…',
  downloading: 'Downloading the fix…',
  restarting: 'Restarting…',
  latest: 'Check again',
  offline: 'Check again',
};

const FIX_NOTE: Partial<Record<FixState, string>> = {
  idle: 'Checks for an update now',
  checking: 'Looking for an update',
  downloading: 'Getting the update',
  restarting: 'Opening the app again',
  latest: "You're on the newest version. A fix may not be out yet.",
  offline: "Couldn't reach the update server. Check your connection.",
};

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  // The boundary sits above the app's theme provider (it can catch a throw
  // from inside it), so it brings its own: the phone's light or dark Ember.
  const scheme = useColorScheme();
  const themeId = resolveThemePreference(DEFAULT_THEME_PREFERENCE, scheme === 'dark' ? 'dark' : 'light');
  return (
    <ThemeProvider themeId={themeId}>
      <ErrorScreen error={error} retry={retry} />
    </ThemeProvider>
  );
}

function ErrorScreen({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const insets = useSafeAreaInsets();
  const [fix, setFix] = React.useState<FixState>('idle');
  const [showDetails, setShowDetails] = React.useState(false);

  // HOUP-258: unconditional (not __DEV__-gated) so a release build still
  // leaves a greppable stack in logcat (console.error routes to the
  // ReactNativeJS tag on both dev and release).
  React.useEffect(() => {
    console.error('[ErrorBoundary]', error?.message, error?.stack);
  }, [error]);

  const report = React.useMemo(() => buildCrashReport(error, crashContext()), [error]);
  const [outcome, setOutcome] = React.useState<CrashOutcome | null>(null);
  React.useEffect(() => {
    let live = true;
    void reportCrash(report, sendCrash, { keepOffline: true })
      .catch((): CrashOutcome => 'skipped')
      .then((result) => live && setOutcome(result));
    return () => {
      live = false;
    };
  }, [report]);
  const sendByHand = React.useCallback(() => {
    setOutcome('skipped');
    void reportCrash(report, sendCrash, { byHand: true })
      .catch((): CrashOutcome => 'skipped')
      .then(setOutcome);
  }, [report]);
  const sentNote = crashReceiptNote(outcome === 'known' || (outcome && typeof outcome === 'object') ? outcome : null);

  const busy = fix === 'checking' || fix === 'downloading' || fix === 'restarting';

  const checkForFix = React.useCallback(async () => {
    setFix('checking');
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setFix('latest');
        return;
      }
      setFix('downloading');
      await Updates.fetchUpdateAsync();
      setFix('restarting');
      await Updates.reloadAsync();
    } catch {
      setFix('offline');
    }
  }, []);

  const note = FIX_NOTE[fix];

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="flex-grow items-center justify-center gap-6 px-8"
      contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <RooftapTile size="xl" />
      <View className="items-center gap-1.5">
        <Text className="text-center font-heading text-title font-semibold text-foreground">This screen tripped</Text>
        <Text className="max-w-xs text-center text-body text-muted-foreground">
          Your data is safe. A fix usually comes as an update, so check for one, or try again.
        </Text>
      </View>
      <View className="w-full max-w-sm">
        <ListGroup>
          {Updates.isEnabled && (
            <ListItem className="items-center gap-3" disabled={busy} onPress={checkForFix} accessibilityRole="button">
              <Tile Icon={Download} />
              <ListItemContent>
                <ListItemTitle className="text-primary">{FIX_LABEL[fix]}</ListItemTitle>
                {note && (
                  <ListItemMeta>
                    <Text className="text-caption text-muted-foreground">{note}</Text>
                  </ListItemMeta>
                )}
              </ListItemContent>
            </ListItem>
          )}
          <ListItem className="items-center gap-3" disabled={busy} onPress={() => retry()} accessibilityRole="button">
            <Tile Icon={RotateCcw} />
            <ListItemContent>
              <ListItemTitle>Try again</ListItemTitle>
            </ListItemContent>
          </ListItem>
          <ListItem className="items-center gap-3" onPress={() => setShowDetails((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showDetails }}>
            <ListItemContent>
              <ListItemTitle>What we sent</ListItemTitle>
              <ListItemMeta>
                <Text className="text-caption text-muted-foreground">{sentNote ?? (outcome === null ? 'Sending a report' : outcome === 'off' ? 'Reports are off on this phone' : 'See what the report holds')}</Text>
              </ListItemMeta>
            </ListItemContent>
            <ListItemTrailing className="mt-0">
              {showDetails ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
            </ListItemTrailing>
          </ListItem>
        </ListGroup>
      </View>
      {showDetails && (
        <View className="w-full max-w-sm gap-3">
          <View className="gap-1 rounded-xl bg-muted p-3">
            {crashReportLines(report).map((line, i) => (
              <Text key={i} selectable className="font-mono text-caption text-foreground">
                <Text className="font-mono text-caption text-muted-foreground">{line.label.padEnd(7)}</Text>
                {line.value}
              </Text>
            ))}
          </View>
          {outcome === 'off' ? (
            <Button size="lg" variant="outline" className="h-11" onPress={sendByHand}>
              <Text className="text-body font-medium text-foreground">Send this report</Text>
            </Button>
          ) : null}
          <Text className="text-center text-caption text-muted-foreground">
            {outcome === 'off'
              ? 'Crash reports are off on this phone. Only what you see above is sent.'
              : 'This is everything the report holds. Turn reports off in Settings > About & updates.'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

/** A row's small neutral icon tile. */
function Tile({ Icon }: { Icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <View className="size-9 items-center justify-center rounded-[11px] bg-muted">
      <Icon size={18} className="text-foreground" />
    </View>
  );
}
