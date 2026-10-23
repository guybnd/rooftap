// HOUP-154: real native push registration, replacing HOUP-84's honest
// "not wired" card now that expo-notifications is installed. getPermissionsAsync
// resolves current OS state; enabling requests permission (if needed), pulls an
// Expo push token, and POSTs it to /api/push/device-token via the same
// authedFetch pattern apps/mobile/src/features/calendar/calendar-api.ts uses
// (Bearer token — native has no cookie jar for the web origin). The registered
// token is persisted in SecureStore so the toggle state survives app restarts
// and disable can DELETE the exact token that was registered.
import * as React from 'react';
import { Platform, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Bell, BellOff, BellRing } from 'lucide-react-native';
import { ListItem, ListItemContent, SegmentedControl, Text } from '@homeup/ui';
import { LEAVE_ALERT_OPTIONS, leaveAlertMinutes, useModules, type ModuleId } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';
import { useDataCache } from '@/lib/data-cache';
import { ReplyNotificationRows } from './assistant-settings';
import { SettingsInset, SettingsLabel, SettingsPanel, SettingsSwitchRow } from './settings-panel';

// HOUP-174: exported so the settings hub row (settings/index.tsx) can read
// the same registered-token state for its E2 "Notifications  On/Off ›" value
// without re-deriving a second storage key.
export const TOKEN_KEY = 'homeup.pushToken';

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');

  const supabase = getCurrentSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return fetch(`${server.origin}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...init?.headers,
    },
  });
}

function getEasProjectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
}

export function NotificationsSettings() {
  const { isOnline } = useDataCache();
  const [osGranted, setOsGranted] = React.useState<boolean | null>(null);
  const [registeredToken, setRegisteredToken] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const [perm, storedToken] = await Promise.all([
        Notifications.getPermissionsAsync(),
        SecureStore.getItemAsync(TOKEN_KEY),
      ]);
      if (cancelled) return;
      setOsGranted(perm.granted);
      setRegisteredToken(storedToken);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = osGranted === true && !!registeredToken;

  const enable = async () => {
    setError(null);
    if (!isOnline) return;
    const projectId = getEasProjectId();
    if (!projectId) {
      setError("Push isn't set up on this server yet.");
      return;
    }
    setBusy(true);
    try {
      let granted = (await Notifications.getPermissionsAsync()).granted;
      if (!granted) {
        granted = (await Notifications.requestPermissionsAsync()).granted;
      }
      setOsGranted(granted);
      if (!granted) {
        setError('Notifications are blocked. Enable them in your device settings.');
        return;
      }

      const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
      const res = await authedFetch('/api/push/device-token', {
        method: 'POST',
        body: JSON.stringify({ expoPushToken: token, platform: Platform.OS }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      setRegisteredToken(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setError(null);
    if (!isOnline || !registeredToken) return;
    setBusy(true);
    try {
      await authedFetch('/api/push/device-token', {
        method: 'DELETE',
        body: JSON.stringify({ expoPushToken: registeredToken }),
      }).catch(() => {});
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      setRegisteredToken(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disable notifications.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = enabled ? disable : enable;

  return (
    <SettingsPanel
      icon={Bell}
      title="Push notifications"
      description="Rooftap sends these to this phone. Tapping one opens what it is about."
    >
      {osGranted === false && (
        <View className="flex-row items-start gap-3 rounded-xl bg-muted/30 px-3.5 py-3">
          <BellOff size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-sm font-medium text-foreground">Notifications are blocked</Text>
            <Text className="text-caption text-muted-foreground">
              Turn them on for Rooftap in your device settings, then come back and try again.
            </Text>
          </View>
        </View>
      )}

      <SettingsInset>
        <SettingsSwitchRow
          title="On this phone"
          description={busy ? 'Working…' : enabled ? 'On for this device' : undefined}
          checked={enabled}
          onChange={() => void toggle()}
          disabled={busy || !isOnline || osGranted === null}
        />
      </SettingsInset>

      {!isOnline && <Text className="px-1 text-caption text-muted-foreground">Connect to change this setting.</Text>}
      {error && <Text className="px-1 text-caption text-destructive">{error}</Text>}
    </SettingsPanel>
  );
}

/** A kind of push with no switch of its own: the switch above covers it. */
function KindRow({ title, description }: { title: string; description: string }) {
  return (
    <ListItem disabled className="min-h-[52px] items-center px-3.5">
      <ListItemContent>
        <Text className="text-sm font-medium text-foreground">{title}</Text>
        <Text className="text-caption text-muted-foreground">{description}</Text>
      </ListItemContent>
    </ListItem>
  );
}

/** Every push the app sends, grouped by module, with the switches each one has. */
export function NotificationKinds() {
  const modules = useModules();
  const has = (id: ModuleId) => modules.enabled.has(id);
  const assistant = has('assistant') && modules.server('assistant.reply-notifications');
  if (!has('household') && !has('calendar') && !assistant && !has('shopper')) return null;

  return (
    <SettingsPanel icon={BellRing} title="What you get" description="Pushes for the modules your home uses.">
      {has('household') && (
        <View className="gap-1.5">
          <SettingsLabel>Tasks</SettingsLabel>
          <SettingsInset>
            <KindRow title="Due, assigned or commented" description="When a task is due, someone gives you one, or someone comments on yours." />
          </SettingsInset>
        </View>
      )}
      {has('calendar') && (
        <View className="gap-1.5">
          <SettingsLabel>Calendar</SettingsLabel>
          <SettingsInset>
            <KindRow title="Event reminders" description="A week and a day before, or on the days an event picks." />
            <LeaveAlertSetting />
          </SettingsInset>
        </View>
      )}
      {assistant && (
        <View className="gap-1.5">
          <SettingsLabel>Assistant</SettingsLabel>
          <ReplyNotificationRows
            description={
              has('money-insights')
                ? 'When Rooftap answers after you leave, a new Household message, or a money note.'
                : 'When Rooftap answers after you leave, or a new Household message.'
            }
          />
        </View>
      )}
      {has('shopper') && (
        <View className="gap-1.5">
          <SettingsLabel>Shopper</SettingsLabel>
          <SettingsInset>
            <KindRow title="Scout results" description="When a search you started has its picks." />
          </SettingsInset>
        </View>
      )}
    </SettingsPanel>
  );
}

/** How long before leaving an event's "time to leave" push comes (user_settings.leave_alert_minutes). */
function LeaveAlertSetting() {
  const { userSettings, refresh } = useDataCache();
  const modules = useModules();
  const saved = String(leaveAlertMinutes(userSettings));
  const [value, setValue] = React.useState(saved);
  React.useEffect(() => setValue(saved), [saved]);
  if (!modules.enabled.has('calendar')) return null;

  const change = async (next: string) => {
    setValue(next);
    try {
      const supabase = getCurrentSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, leave_alert_minutes: Number(next), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      await refresh();
    } catch {
      // Offline: the choice shows now and is saved the next time it changes online.
    }
  };

  // The control sits under the text at full width: beside the label it ran
  // past the card's edge on a phone.
  return (
    <View className="gap-2.5 px-3.5 py-3">
      <View className="gap-0.5">
        <Text className="text-sm font-medium text-foreground">Time to leave</Text>
        <Text className="text-caption text-muted-foreground">
          How long before you need to set off, for events with Getting there on.
        </Text>
      </View>
      <SegmentedControl
        options={LEAVE_ALERT_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
        value={value}
        onChange={(v) => void change(v)}
        size="sm"
        accessibilityLabel="Time to leave alert"
      />
    </View>
  );
}
