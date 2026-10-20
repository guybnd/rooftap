// HOUP-84: native port of apps/web/src/components/pat-settings.tsx (HOUP-4
// self-service bot API key). Calls the same `${origin}/api/pat` route web
// uses, adding an `Authorization: Bearer <access_token>` header since native
// has no browser cookie jar to send — apps/web/src/lib/supabase/session.ts's
// getSessionUser() (used by app/api/pat/route.ts) accepts that header as of
// HOUP-100/HOUP-125, so generate/refresh/revoke all work from this panel.
//
// expo-clipboard is not a dependency (checked apps/mobile/package.json) and
// wasn't added for this single call site. The reveal sheet uses a
// long-press-to-select `<Text selectable>` instead of a copy button — that
// needs no new package and uses the OS's native text-selection "Copy" menu
// on both iOS and Android.
import * as React from 'react';
import { Alert, View } from 'react-native';
import { Bot, KeyRound } from 'lucide-react-native';
import {
  Text,
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SegmentedControl,
  haptics,
} from '@homeup/ui';
import { timeAgo, timeUntil, DEFAULT_PAT_EXPIRY, PAT_EXPIRY_OPTIONS, type PatExpiryChoice } from '@homeup/core';
import { getStoredServer } from '@/lib/server-config';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { SettingsLabel, SettingsPanel } from './settings-panel';

interface PatStatus {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

type State = { state: 'checking' } | { state: 'none' } | { state: 'active'; pat: PatStatus };

async function patRequest(method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: object): Promise<Response> {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');
  const supabase = getCurrentSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in.');
  return fetch(`${server.origin}/api/pat`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function PatSettings() {
  const [state, setState] = React.useState<State>({ state: 'checking' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revealToken, setRevealToken] = React.useState<string | null>(null);
  const [expiry, setExpiry] = React.useState<PatExpiryChoice>(DEFAULT_PAT_EXPIRY);

  const load = React.useCallback(async () => {
    try {
      const res = await patRequest('GET');
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();
      setState(data.active ? { state: 'active', pat: data.pat } : { state: 'none' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load API key status.');
      setState({ state: 'none' });
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const generate = React.useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await patRequest('POST', { expiry });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server responded ${res.status}`);
      haptics.success();
      setRevealToken(data.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate API key.');
    } finally {
      setBusy(false);
    }
  }, [load, expiry]);

  const refresh = React.useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await patRequest('PUT', { expiry });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server responded ${res.status}`);
      haptics.success();
      setRevealToken(data.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh API key.');
    } finally {
      setBusy(false);
    }
  }, [load, expiry]);

  const doRevoke = React.useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await patRequest('DELETE');
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      haptics.warn();
      setState({ state: 'none' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke API key.');
    } finally {
      setBusy(false);
    }
  }, []);

  const revoke = React.useCallback(() => {
    Alert.alert('Revoke this API key?', 'Anything using it will stop working immediately.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: doRevoke },
    ]);
  }, [doRevoke]);

  const closeReveal = React.useCallback(() => {
    setRevealToken(null);
  }, []);

  return (
    <>
      <SettingsPanel
        icon={Bot}
        title="Bot API key"
        description="A personal access token so an outside agent can read your Rooftap data."
      >
        {state.state === 'checking' && <Text className="text-body text-muted-foreground">Loading…</Text>}

        {state.state === 'none' && (
          <View className="gap-3">
            <View className="gap-1.5">
              <SettingsLabel>New key expires</SettingsLabel>
              <SegmentedControl
                options={PAT_EXPIRY_OPTIONS}
                value={expiry}
                onChange={setExpiry}
                size="sm"
                accessibilityLabel="Key expiry"
              />
            </View>
            <Button onPress={generate} disabled={busy} size="sm" variant="outline" className="self-start px-3">
              <KeyRound size={14} className="text-foreground" />
              <Text className="text-sm font-medium text-foreground">Generate API key</Text>
            </Button>
          </View>
        )}

        {state.state === 'active' && (
          <View className="gap-3">
            <View className="gap-0.5 rounded-xl bg-muted/30 px-3.5 py-3">
              <View className="flex-row items-center gap-1.5">
                <View className={`size-1.5 rounded-full ${state.pat.expired ? 'bg-warning' : 'bg-success'}`} />
                <Text className="text-sm font-medium text-foreground">{state.pat.expired ? 'Expired' : 'Active'}</Text>
              </View>
              {/* H6: one middle dot per line. */}
              <Text className="text-caption text-muted-foreground">
                Issued {timeAgo(state.pat.createdAt)}
                {' · '}
                {state.pat.lastUsedAt ? `last used ${timeAgo(state.pat.lastUsedAt)}` : 'never used'}
              </Text>
              {state.pat.expired ? (
                <Text className="text-caption text-muted-foreground">
                  Refresh to get a new key. Anything using this one has stopped working.
                </Text>
              ) : (
                <Text className="text-caption text-muted-foreground">
                  {state.pat.expiresAt ? `Expires ${timeUntil(state.pat.expiresAt) ?? 'soon'}` : 'Never expires'}
                </Text>
              )}
            </View>
            <View className="gap-1.5">
              <SettingsLabel>Refreshed key expires</SettingsLabel>
              <SegmentedControl
                options={PAT_EXPIRY_OPTIONS}
                value={expiry}
                onChange={setExpiry}
                size="sm"
                accessibilityLabel="Key expiry"
              />
            </View>
            <View className="flex-row items-center gap-2">
              <Button onPress={refresh} disabled={busy} size="sm" variant="outline" className="px-3">
                Refresh
              </Button>
              {/* E4: destructive is danger text, no fill. */}
              <Button onPress={revoke} disabled={busy} size="sm" variant="ghost" className="px-3" textClassName="text-destructive">
                Revoke
              </Button>
            </View>
          </View>
        )}

        {error && <Text className="px-1 text-caption text-destructive">{error}</Text>}
      </SettingsPanel>

      <Sheet open={!!revealToken} onOpenChange={(open) => !open && closeReveal()}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Your API key</SheetTitle>
            <SheetDescription>
              Copy it now. It won't be shown again.
            </SheetDescription>
          </SheetHeader>
          <View className="mx-4 rounded-lg border border-border bg-muted/30 p-3">
            <Text selectable className="font-mono text-xs text-foreground">
              {revealToken}
            </Text>
          </View>
          <Text className="mx-4 mt-2 text-xs text-muted-foreground">
            Tap and hold the key above to select and copy it.
          </Text>
          <View className="p-4">
            <Button variant="outline" onPress={closeReveal}>
              Done
            </Button>
          </View>
        </SheetContent>
      </Sheet>
    </>
  );
}
