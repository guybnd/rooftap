// HOUP-84: native port of apps/web's calendar-setup.tsx — Google Calendar
// SOURCE configuration (NOT the calendar view itself; that's HOUP-87's
// apps/mobile/src/app/(tabs)/calendar/index.tsx).
//
// Every control in the web panel — connect/disconnect, calendar selection,
// pull/push toggles, undated-to-do push schedule, timezone, import defaults,
// suggestion keywords — lives behind a live "connected" state fetched from
// GET /api/calendar/status and edited via PUT /api/calendar/calendars. Both
// endpoints only accept the Supabase session *cookie* (apps/web/src/lib/
// supabase/session.ts's getSessionUser()); native has no cookie jar, only a
// SecureStore-held access token, so every fetch would 401. That backend gap
// (Bearer-token auth on /api/calendar/*) is already tracked as its own
// prerequisite ticket, HOUP-100, which also covers the rest of the native
// Google Calendar sync surface (status/events/import/dismiss/share) for the
// live Calendar screen.
//
// The OAuth "Connect" flow itself is separately browser-only: it reads
// `window.location`, sets a `document.cookie` mismatch guard, and redirects
// through supabase.auth.signInWithOAuth to a web-only /calendar-callback
// route. There's no native (deep-link) equivalent yet.
//
// Because the web panel gates literally every setting behind that
// unreachable "connected" state, there is no separable sub-feature that
// works today to port for real (unlike, say, a browser-only file picker
// living alongside otherwise-functional controls) — faking any of those
// toggles would misrepresent a capability the app doesn't have. This renders
// one honest deferred state instead; every branch above becomes portable
// once HOUP-100's Bearer-token support lands.
import { View } from 'react-native';
import { CalendarClock } from 'lucide-react-native';
import { Text } from '@homeup/ui';
import { SettingsPanel } from './settings-panel';

export function CalendarSetup() {
  // H2/H4: no status pill and no second bordered box; the deferred state is
  // a plain inset note inside the panel.
  return (
    <SettingsPanel
      icon={CalendarClock}
      title="Google Calendar"
      description="Pull your Google events into Rooftap (private by default), and push appointments and to-dos out to Google."
    >
      <View className="gap-1 rounded-xl bg-muted/30 px-3.5 py-3">
        <Text className="text-sm font-medium text-foreground">Not on the app yet</Text>
        <Text className="text-caption text-muted-foreground">
          Connect and manage Google Calendar from Rooftap on the web for now. What you set there applies here once the
          app supports it.
        </Text>
      </View>
    </SettingsPanel>
  );
}
