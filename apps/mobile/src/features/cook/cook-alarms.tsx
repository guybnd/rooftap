// Recipes v2 R2: phone timers ring through a scheduled local notification.
// Every timer this phone started gets one notification at its end time on a
// high-importance "Timers" channel, so it rings with the app closed. Pause,
// +1 min and stop reschedule or cancel it: the set of scheduled timers is
// kept in step with the running cooks, not patched per tap. Timers started
// on the web ring there, never here (the phone of who set it).
//
// While a timer runs, a quiet notification on a "Running timers" channel
// says what is cooking and when it is ready ("Ready at 7:42 PM"), so the
// timer shows in the notification bar with the app closed. It goes when the
// timer ends, is stopped, or the app next sees it done.
//
// This is the OTA version: no live countdown in the bar, a notification can
// be late in deep Doze (no exact-alarm permission), and it rings once.
// Alarm-grade ringing and a live countdown come with the R8 APK.
import * as React from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { cookDeviceId, liveDeviceTimers, timerDoneText, timerLiveText, timersToRing, useCooks } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';

export const COOK_TIMER_CHANNEL = 'timers';
const RUNNING_CHANNEL = 'timers-running';
const RUNNING_PREFIX = 'cook-running-';
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
    .then(() =>
      Notifications.setNotificationChannelAsync(RUNNING_CHANNEL, {
        name: 'Running timers',
        description: 'Shows a cooking timer while it runs',
        importance: Notifications.AndroidImportance.LOW,
        sound: null,
        vibrationPattern: null,
        enableVibrate: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      }),
    )
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

/** "7:42 PM" in the phone's own format. */
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** What each running-timer notification last said, so an unchanged one is not posted again. */
const shownRunning = new Map<string, string>();

/** Post, update or clear the running-timer notifications to match `wanted`. */
async function syncRunning(wanted: Map<string, { title: string; body: string; url: string }>): Promise<void> {
  if (Platform.OS !== 'android') return;
  const presented = await Notifications.getPresentedNotificationsAsync();
  for (const n of presented) {
    const id = n.request.identifier;
    if (id.startsWith(RUNNING_PREFIX) && !wanted.has(id)) {
      await Notifications.dismissNotificationAsync(id);
      shownRunning.delete(id);
    }
  }
  const showing = new Set(presented.map((n) => n.request.identifier));
  for (const [id, want] of wanted) {
    const key = `${want.title}\n${want.body}`;
    if (showing.has(id) && shownRunning.get(id) === key) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: want.title,
        body: want.body,
        sound: false,
        priority: Notifications.AndroidNotificationPriority.LOW,
        data: { kind: 'cook-running', url: want.url },
      },
      trigger: { channelId: RUNNING_CHANNEL },
    });
    shownRunning.set(id, key);
  }
}

export function CookAlarms() {
  const { group, currentUserId } = useDataCache();
  const cooks = useCooks(group?.id, currentUserId);
  const [foreground, setForeground] = React.useState(0);
  // Bumped when a running timer ends while the app is open, so its
  // notification-bar line goes as the ring arrives.
  const [tick, setTick] = React.useState(0);

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
    const now = Date.now();
    const running = new Map<string, { title: string; body: string; url: string }>();
    let nextEnd = Infinity;
    for (const { timer, session } of liveDeviceTimers(
      cooks.cooks.map((c) => c.session),
      cookDeviceId(),
      now,
    )) {
      const cook = cooks.cooks.find((c) => c.session.id === session.id);
      running.set(`${RUNNING_PREFIX}${timer.id}`, {
        url: `/recipes/${session.recipe_id}`,
        ...timerLiveText(timer, cook?.recipe.title ?? 'Cooking', now, clock),
      });
      if (timer.pausedRemaining == null && timer.endsAt) nextEnd = Math.min(nextEnd, Date.parse(timer.endsAt));
    }
    const endTimer = Number.isFinite(nextEnd) ? setTimeout(() => setTick((n) => n + 1), Math.max(0, nextEnd - now) + 500) : null;
    void (async () => {
      try {
        await ensureChannel();
        // The bar line is a nice-to-have: a failure here must not stop the ring below.
        await syncRunning(running).catch(() => undefined);
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
      if (endTimer) clearTimeout(endTimer);
    };
  }, [cooks.enabled, cooks.cooks, foreground, tick]);

  return null;
}
