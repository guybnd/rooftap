import * as React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getBoundSupabaseClient } from './supabase-client';

// HOUP-76: supabase-js's autoRefreshToken timer relies on the JS runtime
// actually ticking, which the OS suspends while the app is backgrounded — a
// refresh window can be missed entirely. supabase-js's own React Native
// guidance is to drive the refresh loop off AppState explicitly rather than
// relying on the client's internal timer alone: start it when foregrounded,
// stop it (save battery, avoid firing while suspended) when backgrounded. A
// missed refresh is still self-healing without this — the next
// getSession()/API call refreshes on demand — so this is a proactive
// improvement, not a correctness fix.
export function useAuthAutoRefresh(): void {
  React.useEffect(() => {
    const applyForState = (state: AppStateStatus) => {
      const client = getBoundSupabaseClient();
      if (!client) return;
      if (state === 'active') {
        void client.auth.startAutoRefresh();
      } else {
        void client.auth.stopAutoRefresh();
      }
    };

    applyForState(AppState.currentState);
    const sub = AppState.addEventListener('change', applyForState);
    return () => sub.remove();
  }, []);
}
