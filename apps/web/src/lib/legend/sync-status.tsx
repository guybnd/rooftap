'use client';

// FLUX-263: app-shell visibility for the Legend-State write outbox.
//
// - LegendSyncBootstrap activates every group store as soon as the group is
//   known, so persisted pending writes (retrySync) replay on app open — not
//   only when the user happens to visit the section page that owns the store.
//   (Before this, a recipe saved on a phone with a bad connection stayed
//   half-synced until that phone next opened the *recipes* page.)
//   Modules (.docs/modules.md): only the stores of modules that are on, and
//   switching one on starts its stores without a reload (store-modules.ts).
//   A switched-off module's unsent offline writes wait until it's back on.
// - useLegendPendingCount counts every synced store's unacknowledged writes so
//   the offline/sync banner can show work that hasn't reached Supabase yet.

import { useEffect, useState } from 'react';
import { getAllSyncStates } from '@legendapp/state/sync';
import { useDataCache } from '@/lib/data-cache';
import {
  groceryItems$,
  householdTasks$,
  costItems$,
  setupItems$,
  checklists$,
  checklistItems$,
  checklistTemplates$,
  checklistTemplateItems$,
  recipes$,
  recipeIngredients$,
  groupEvents$,
  apartments$,
  agents$,
  apartmentAgents$,
  apartmentComments$,
  savedSearches$,
  appointments$,
  apartmentChecklistItems$,
  apartmentChecklistResponses$,
  documents$,
  isStoreSynced,
  useModules,
} from '@homeup/core';

const ALL_STORES = [
  groceryItems$,
  householdTasks$,
  costItems$,
  setupItems$,
  checklists$,
  checklistItems$,
  checklistTemplates$,
  checklistTemplateItems$,
  recipes$,
  recipeIngredients$,
  groupEvents$,
  apartments$,
  agents$,
  apartmentAgents$,
  apartmentComments$,
  savedSearches$,
  appointments$,
  apartmentChecklistItems$,
  apartmentChecklistResponses$,
  documents$,
] as const;

/**
 * Mount once inside DataCacheProvider. Renders nothing; reading each store
 * activates its sync — IndexedDB hydration, initial pull, realtime channel,
 * and (critically) replay of persisted pending writes from earlier sessions.
 */
export function LegendSyncBootstrap() {
  const { group } = useDataCache();
  const groupId = group?.id;
  const { enabled } = useModules();

  useEffect(() => {
    if (!groupId) return;
    for (const store$ of ALL_STORES) {
      if (isStoreSynced(store$.collection, enabled)) store$(groupId).get();
    }
  }, [groupId, enabled]);

  return null;
}

const POLL_MS = 1500;

/**
 * Number of row-level Legend changes written locally but not yet confirmed by
 * Supabase (in-flight, retrying, or queued offline). Polled — pending state
 * lives outside the observable graph, so there is nothing reactive to track.
 */
export function useLegendPendingCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const read = () => {
      let n = 0;
      for (const [state$] of getAllSyncStates()) {
        const pending = state$.getPendingChanges();
        if (pending) n += Object.keys(pending).length;
      }
      setCount(n);
    };
    read();
    const timer = setInterval(read, POLL_MS);
    const onWake = () => read();
    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, []);

  return count;
}
