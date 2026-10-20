// HOUP-68 scaffolded this as an unconditional redirect to /home. HOUP-69
// adds the real cold-boot gate: no stored server -> first-run picker; a
// stored server with no valid session -> login; otherwise straight to the
// app, skipping the picker on every later launch (the "does it remember it"
// requirement).
//
// Cold-start fix: decides from the stored session's presence, not from
// auth.getSession(), which blocks on a token refresh round trip whenever the
// access token has expired (every launch more than an hour after the last).
// The client is still bound here so that refresh starts right away in the
// background.
import * as React from 'react';
import { Redirect } from 'expo-router';
import { ScreenBackground } from '@homeup/ui';
import { getStoredServer } from '@/lib/server-config';
import { getSupabaseClient, hasStoredSession } from '@/lib/supabase-client';

type Destination = '/server-picker' | '/login' | '/home';

export default function Index() {
  const [destination, setDestination] = React.useState<Destination | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const server = await getStoredServer();
      if (!server) {
        if (!cancelled) setDestination('/server-picker');
        return;
      }
      getSupabaseClient(server.config);
      const signedIn = await hasStoredSession(server.config);
      if (!cancelled) setDestination(signedIn ? '/home' : '/login');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Paint the theme's page surface while deciding: returning null left the
  // Stack's default (near-white) card showing, a white flash on every cold
  // start once the splash overlay faded.
  if (!destination) return <ScreenBackground />;
  return <Redirect href={destination} />;
}
