// HOUP-154: routes a tapped push notification to its deep-link target.
// Mirrors the web service worker's notificationclick handler
// (apps/web/src/app/sw.ts) — the Edge payload's `data.url` is the same
// `/tasks?focus=<id>` path (`taskUrl()`, supabase/functions/_shared/send-push.ts).
// setNotificationHandler runs at module load (not inside the hook) so a
// foreground notification is still presented even before any screen mounts
// this hook.
import * as React from 'react';
import * as Notifications from 'expo-notifications';
import { assistantConversationFromUrl, openAssistantPopup, snoozeMinutesFromAction } from '@homeup/core';
import { handleSnoozeResponse } from './notification-snooze';
import { useOpenRoute } from './tab-routes';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => ({
    // A running cooking timer's quiet line goes to the bar, never a banner
    // over the app you are cooking in.
    shouldShowBanner: notification.request.content.data?.kind !== 'cook-running',
    shouldShowList: true,
    // A finished cooking timer (features/cook/cook-alarms.tsx) rings in the
    // foreground too; other pushes stay quiet while the app is open.
    shouldPlaySound: notification.request.content.data?.kind === 'cook-timer',
    shouldSetBadge: false,
  }),
});

async function routeFromResponse(openRoute: (href: string) => void, response: Notifications.NotificationResponse) {
  // A snooze button hides the notification for later and opens nothing.
  if (await handleSnoozeResponse(response).catch(() => true)) return;
  const url = response.notification.request.content.data?.url;
  if (typeof url !== 'string' || !url.startsWith('/')) return;
  // "Rooftap answered" opens the pop-up chat over the current screen, painting
  // the thread at once when it's in memory, instead of a cold chat screen.
  const conversationId = assistantConversationFromUrl(url);
  if (conversationId && openAssistantPopup({ conversationId })) return;
  openRoute(url);
}

export function usePushNotificationRouting(): void {
  // Read through a ref: openRoute changes with every navigation, and the
  // listener below shouldn't resubscribe on each one.
  const openRoute = useOpenRoute();
  const openRouteRef = React.useRef(openRoute);
  React.useEffect(() => {
    openRouteRef.current = openRoute;
  }, [openRoute]);
  const handledLaunchResponse = React.useRef(false);

  React.useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handledLaunchResponse.current = true;
      void routeFromResponse((href) => openRouteRef.current(href), response);
    });

    // Cold-start tap: the response that launched the app from a terminated
    // state is never delivered to the listener above, so it must be read
    // separately. getLastNotificationResponseAsync() keeps returning the
    // same persisted response on every call, so a ref guards against
    // re-routing it if the effect ever runs again.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response || handledLaunchResponse.current) return;
      handledLaunchResponse.current = true;
      // A snooze button never opens the app: its background task already
      // snoozed it, and snoozing again now would push it later still.
      if (snoozeMinutesFromAction(response.actionIdentifier) !== null) {
        void Notifications.clearLastNotificationResponseAsync();
        return;
      }
      void routeFromResponse((href) => openRouteRef.current(href), response);
      // The persisted response otherwise survives full app restarts and
      // would re-route every subsequent normal cold launch to this same
      // stale target — clear it once consumed.
      void Notifications.clearLastNotificationResponseAsync();
    });

    return () => subscription.remove();
  }, []);
}
