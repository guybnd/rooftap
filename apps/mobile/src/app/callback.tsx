// HOUP-193: expo-router requires a registered screen for every reachable
// path — Google's OAuth redirect (`mobile://callback`, set via
// makeRedirectUri({ path: '/callback' }) in login.tsx) was delivered to
// expo-router as an in-app navigation with no matching route, surfacing an
// "Unmatched Route" flash before login.tsx's own openAuthSessionAsync()
// promise resolved and navigated onward. This screen is the landing pad for
// that deep link: it tries to parse + set the session itself (the same
// tokens login.tsx's promise-based handler is racing to land, in case the OS
// delivers the redirect as a Linking event rather than resolving the
// browser-session promise — a known platform inconsistency), then shows a
// branded spinner until a session exists either way, and times out back to
// /login rather than stranding the user on a spinner forever.
//
// HOUP-209: the token-parse fallback below reads `useLinkingURL()`, not
// `getInitialURL()` — the app is warm here (the browser just redirected back
// into a running app), so `getInitialURL()` (the *cold-start* launch URL)
// never carries these tokens. `useLinkingURL()` returns the same initial URL
// synchronously on mount AND updates when the OS delivers the redirect as a
// later Linking event, which is the actual race this fallback exists to
// cover.
import * as React from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import * as Linking from 'expo-linking';
import { getQueryParams } from 'expo-auth-session/build/QueryParams';
import { ScreenBackground } from '@homeup/ui';
import { getStoredServer } from '@/lib/server-config';
import { getSupabaseClient } from '@/lib/supabase-client';

const FALLBACK_TIMEOUT_MS = 8000;

export default function CallbackScreen() {
  const router = useRouter();
  const url = Linking.useLinkingURL();

  React.useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function waitForSession() {
      const server = await getStoredServer();
      if (cancelled) return;
      if (!server) {
        router.replace('/login');
        return;
      }

      const supabase = getSupabaseClient(server.config);

      // Already landed by login.tsx's own handler (or a prior run of this
      // effect) — nothing left to do.
      const { data: existing } = await supabase.auth.getSession();
      if (cancelled) return;
      if (existing.session) {
        router.replace('/home');
        return;
      }

      // This screen's own URL may carry the tokens directly (the deep link
      // that routed here in the first place) — set the session from them if
      // so. Idempotent with login.tsx: whichever of the two sets it first
      // wins, the other's setSession() call is a harmless no-op overwrite of
      // the same tokens.
      if (url) {
        const { params, errorCode } = getQueryParams(url);
        if (params.access_token && params.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
          if (cancelled) return;
          router.replace(error ? '/login' : '/home');
          return;
        }
        if (errorCode || params.error) {
          router.replace('/login');
          return;
        }
      }

      // No tokens on this screen's own URL — login.tsx's handler owns this
      // sign-in attempt via openAuthSessionAsync(); wait for its setSession()
      // to land.
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled || !session) return;
        router.replace('/home');
      });
      unsubscribe = () => subscription.unsubscribe();
    }

    waitForSession();
    const timeout = setTimeout(() => {
      if (!cancelled) router.replace('/login');
    }, FALLBACK_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      unsubscribe?.();
    };
  }, [router, url]);

  return (
    <ScreenBackground className="items-center justify-center">
      <ActivityIndicator />
    </ScreenBackground>
  );
}
