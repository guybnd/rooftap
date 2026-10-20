// HOUP-177: persistent auth guard. app/index.tsx's cold-boot check
// (getSession() once) and login.tsx's own mount-time check only run when
// those screens mount — a session lost, expired, or revoked *after* that
// (a dead refresh token, another device signing this session out server-side)
// silently falls through to whatever screen is already showing, with no
// equivalent to web's per-request middleware.ts re-check. This subscribes to
// supabase-js's onAuthStateChange for the life of the app and bounces to
// /login the moment the session disappears, from anywhere.
//
// Self-primes the Supabase client (getStoredServer + getSupabaseClient)
// rather than assuming app/index.tsx has already bound it — same rationale
// as DataCacheProvider's own self-priming (mount order between root-layout
// hooks and routed screens isn't guaranteed).
//
// HOUP-177 follow-up: a plain one-shot subscribe (fire once on mount, never
// again) left two reachable paths unguarded — a fresh install where no
// server is stored yet at mount, and any post-reset re-login (sign-out /
// server-switch both call resetSupabaseClient(), which swaps in a brand new
// client instance that the original subscription isn't bound to). Both
// resubscribe via supabase-client.ts's onSupabaseClientChange notifier
// instead of a React-effect-deps trigger, since the bound client can change
// for reasons entirely outside this hook's own render cycle.
import * as React from 'react';
import { usePathname, useRouter } from 'expo-router';
import { redirectToLogin } from './auth-redirect';
import { getStoredServer } from './server-config';
import { getSupabaseClient, onSupabaseClientChange } from './supabase-client';

export function useAuthGuard(): void {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = React.useRef(pathname);
  React.useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  React.useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let unsubscribeAuth: (() => void) | undefined;

    async function subscribe() {
      const thisAttempt = ++attempt;
      unsubscribeAuth?.();
      unsubscribeAuth = undefined;

      const server = await getStoredServer();
      if (cancelled || thisAttempt !== attempt || !server) return;

      const supabase = getSupabaseClient(server.config);
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        // Any event that leaves us without a session — explicit SIGNED_OUT,
        // or a null session on INITIAL_SESSION/TOKEN_REFRESHED/etc. — means
        // there's nothing left to show app screens with.
        if (session && event !== 'SIGNED_OUT') return;
        redirectToLogin(router, pathnameRef.current);
      });
      unsubscribeAuth = () => subscription.unsubscribe();
    }

    subscribe();
    const unsubscribeClientChange = onSupabaseClientChange(() => {
      subscribe();
    });

    return () => {
      cancelled = true;
      unsubscribeClientChange();
      unsubscribeAuth?.();
    };
  }, [router]);
}
