// HOUP-69: first-run (and Settings -> Change server) picker between the
// Official server and a self-hosted one. Non-official origins require an
// explicit confirmation step showing the resolved host before connecting —
// the phishing/SSRF guard from the approved plan/mockup.
import * as React from 'react';
import { View } from 'react-native';
// HOUP-318: keyboard-aware scroll container (same swap as Home/Costs) so an
// inline field low on the page scrolls above the on-screen keyboard.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Text,
  BottomSheet,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  ScreenBackground,
  SegmentedControl,
} from '@homeup/ui';
import {
  OFFICIAL_SERVER_LABEL,
  OFFICIAL_SERVER_URL,
  fetchPublicConfig,
  getStoredServer,
  isOfficialOrigin,
  normalizeServerOrigin,
  storeServer,
  type PublicConfig,
} from '@/lib/server-config';
import { performFullReset, resetSupabaseClient } from '@/lib/supabase-client';

type Mode = 'official' | 'self-host';

export default function ServerPickerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { mode: navMode } = useLocalSearchParams<{ mode?: string }>();
  const isSwitching = navMode === 'switch';

  const [mode, setMode] = React.useState<Mode>(OFFICIAL_SERVER_URL ? 'official' : 'self-host');
  const [customUrl, setCustomUrl] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pendingOrigin, setPendingOrigin] = React.useState<string | null>(null);
  const [pendingConfig, setPendingConfig] = React.useState<PublicConfig | null>(null);

  async function commit(origin: string, config: PublicConfig) {
    const previous = await getStoredServer();

    if (isSwitching && previous && previous.origin === origin) {
      // Re-selecting the same origin is a no-op — no wipe, nothing to store.
      router.back();
      return;
    }

    if (isSwitching && previous && previous.origin !== origin) {
      await performFullReset(previous.config);
    }

    await storeServer(origin, config);
    resetSupabaseClient();
    router.replace('/login');
  }

  async function handleContinue() {
    setError(null);
    setLoading(true);
    try {
      const origin =
        mode === 'official' && OFFICIAL_SERVER_URL
          ? normalizeServerOrigin(OFFICIAL_SERVER_URL)
          : normalizeServerOrigin(customUrl);
      const config = await fetchPublicConfig(origin);

      if (mode === 'official' || isOfficialOrigin(origin)) {
        await commit(origin, config);
      } else {
        setPendingOrigin(origin);
        setPendingConfig(config);
        setConfirmOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!pendingOrigin || !pendingConfig) return;
    setConfirmOpen(false);
    setLoading(true);
    try {
      await commit(pendingOrigin, pendingConfig);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenBackground>
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
      >
        <View className="gap-1">
          <Text className="text-display font-semibold text-foreground">Choose your server</Text>
          <Text className="text-body text-muted-foreground">
            Rooftap can connect to the official service or a server you host yourself.
          </Text>
        </View>
  
        <SegmentedControl
          accessibilityLabel="Server type"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'official', label: OFFICIAL_SERVER_LABEL },
            { value: 'self-host', label: 'Use my own server' },
          ]}
        />
  
        {mode === 'official' && !OFFICIAL_SERVER_URL && (
          <Card>
            <CardHeader>
              <CardTitle>Official server unavailable</CardTitle>
              <CardDescription>
                This build wasn&apos;t configured with an official server address. Use your own server below.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
  
        {mode === 'self-host' && (
          <Card>
            <CardHeader>
              <CardTitle>Server address</CardTitle>
              <CardDescription>Enter the address of your self-hosted Rooftap instance.</CardDescription>
            </CardHeader>
            <View className="px-4">
              <Input
                value={customUrl}
                onChangeText={setCustomUrl}
                placeholder="example.com or https://example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>
          </Card>
        )}
  
        {error && (
          <View className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
            <Text className="text-body text-destructive">{error}</Text>
          </View>
        )}
  
        <View className="flex-row gap-2">
          {isSwitching && (
            <Button variant="outline" onPress={() => router.back()} className="flex-1">
              Cancel
            </Button>
          )}
          <Button onPress={handleContinue} disabled={loading} className="flex-1">
            {loading ? 'Checking...' : 'Continue'}
          </Button>
        </View>
  
        <BottomSheet open={confirmOpen} onOpenChange={setConfirmOpen}>
          <View className="gap-4 px-4 pb-2">
            <View className="gap-1">
              <Text className="font-heading text-title font-semibold text-foreground">Connect to this server?</Text>
              <Text className="text-body text-muted-foreground">
                You&apos;re about to sign in to a server that isn&apos;t the official Rooftap service. Only continue if
                you trust it.
              </Text>
            </View>
            <View className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <Text className="text-body font-medium text-foreground" numberOfLines={1}>
                {pendingOrigin}
              </Text>
            </View>
            <View className="flex-row gap-2">
              <Button variant="outline" onPress={() => setConfirmOpen(false)} className="flex-1">
                Cancel
              </Button>
              <Button onPress={handleConfirm} disabled={loading} className="flex-1">
                Connect
              </Button>
            </View>
          </View>
        </BottomSheet>
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}
