// Recipes v2 R2: phone timers ring through a scheduled local notification.
// Every timer this phone started gets one notification at its end time on a
// high-importance "Timers" channel, so it rings with the app closed. Pause,
// +1 min and stop reschedule or cancel it: the set of scheduled timers is
// kept in step with the running cooks, not patched per tap. Timers started
// on the web ring there, never here (the phone of who set it).
//
// This is the OTA version: a notification can be late in deep Doze and
// rings once. Alarm-grade ringing comes with the R8 APK.
import * as React from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { cookDeviceId, timerDoneText, timersToRing, useCooks } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';

export const COOK_TIMER_CHANNEL = 'timers';
export const COOK_TIMER_KIND = 'cook-timer';
const ID_PREFIX = 'cook-timer-';

let channelReady: Promise<void> | null = null;
function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(COOK_TIMER_CHANNEL, {
    name: 'Timers',
    description: 'Cooking timers you start in Recipes',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 400, 250, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  })
    .then(() => undefined)
    .catch(() => {
      channelReady = null;
    });
  return channelReady ?? Promise.resolve();
}

let asked = false;
/** Ask once, from a tap, so a timer can ring with the app closed. */
export function askTimerNotificationPermission(): void {
  if (asked) return;
  asked = true;
  void Notifications.getPermissionsAsync()
    .then((p) => (p.granted || !p.canAskAgain ? p : Notifications.requestPermissionsAsync()))
    .catch(() => undefined);
}

async function scheduledTimerIds(): Promise<Map<string, number | null>> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const out = new Map<string, number | null>();
  for (const n of all) {
    if (!n.identifier.startsWith(ID_PREFIX)) continue;
    const endsAt = n.content.data?.endsAt;
    out.set(n.identifier, typeof endsAt === 'number' ? endsAt : null);
  }
  return out;
}

export function CookAlarms() {
  const { group, currentUserId } = useDataCache();
  const cooks = useCooks(group?.id, currentUserId);
  const [foreground, setForeground] = React.useState(0);

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setForeground((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  React.useEffect(() => {
    if (!cooks.enabled) return;
    let cancelled = false;
    const wanted = new Map<string, { endsAt: number; title: string; body: string; url: string }>();
    for (const { timer, session, endsAt } of timersToRing(
      cooks.cooks.map((c) => c.session),
      cookDeviceId(),
    )) {
      if (endsAt <= Date.now()) continue;
      const cook = cooks.cooks.find((c) => c.session.id === session.id);
      wanted.set(`${ID_PREFIX}${timer.id}`, {
        endsAt,
        url: `/recipes/${session.recipe_id}`,
        ...timerDoneText(timer, cook?.recipe.title ?? 'Cooking'),
      });
    }
    void (async () => {
      try {
        await ensureChannel();
        const have = await scheduledTimerIds();
        if (cancelled) return;
        for (const [id, endsAt] of have) {
          const want = wanted.get(id);
          if (!want || want.endsAt !== endsAt) await Notifications.cancelScheduledNotificationAsync(id);
        }
        for (const [id, want] of wanted) {
          if (have.get(id) === want.endsAt) continue;
          await Notifications.scheduleNotificationAsync({
            identifier: id,
            content: {
              title: want.title,
              body: want.body,
              sound: 'default',
              priority: Notifications.AndroidNotificationPriority.MAX,
              data: { kind: COOK_TIMER_KIND, endsAt: want.endsAt, url: want.url },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: new Date(want.endsAt),
              channelId: COOK_TIMER_CHANNEL,
            },
          });
        }
      } catch {
        // Scheduling can fail without permission; the in-app ring still shows the timer done.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cooks.enabled, cooks.cooks, foreground]);

  return null;
}
