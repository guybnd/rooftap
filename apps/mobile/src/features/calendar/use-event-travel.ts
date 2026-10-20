// Travel minutes from the household's home to an event's place: native side of
// apps/web/src/lib/use-event-travel.ts, via /api/event-travel with the
// session's Bearer token. `undefined` while unknown or loading, `null` when it
// couldn't be worked out. Answers are kept per app run.
import * as React from 'react';
import type { EventLeg, TravelMode } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

const cache = new Map<string, Promise<number | null>>();

async function load(query: string): Promise<number | null> {
  const server = await getStoredServer();
  if (!server) return null;
  const {
    data: { session },
  } = await getCurrentSupabaseClient().auth.getSession();
  const res = await fetch(`${server.origin}/api/event-travel?${query}`, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data?.minutes === 'number' ? data.minutes : null;
}

export interface EventTravel {
  /** The household's home is set, so travel can be worked out. */
  hasHome: boolean;
  minutes: number | null | undefined;
}

export function useEventTravel(place: string, mode: TravelMode | null, debounceMs = 600): EventTravel {
  const { group } = useDataCache();
  const [minutes, setMinutes] = React.useState<number | null | undefined>(undefined);
  const hasHome = group?.home_lat != null && group?.home_lng != null;
  const query =
    hasHome && mode && place.trim()
      ? new URLSearchParams({
          place: place.trim(),
          mode,
          from_lat: String(group!.home_lat),
          from_lng: String(group!.home_lng),
        }).toString()
      : null;

  React.useEffect(() => {
    setMinutes(undefined);
    if (!query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      let hit = cache.get(query);
      if (!hit) {
        hit = load(query).catch(() => null);
        void hit.then((m) => { if (m === null) cache.delete(query); });
        cache.set(query, hit);
      }
      void hit.then((m) => { if (!cancelled) setMinutes(m); });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, debounceMs]);

  return { hasHome, minutes };
}

/** Travel minutes for a leg between two events (core event-legs.ts), same states as above. */
export function useLegTravel(leg: EventLeg | null): number | null | undefined {
  const [minutes, setMinutes] = React.useState<number | null | undefined>(undefined);
  const query = leg ? new URLSearchParams({ place: leg.to, mode: leg.mode, from: leg.from }).toString() : null;
  React.useEffect(() => {
    setMinutes(undefined);
    if (!query) return;
    let cancelled = false;
    let hit = cache.get(query);
    if (!hit) {
      hit = load(query).catch(() => null);
      void hit.then((m) => { if (m === null) cache.delete(query); });
      cache.set(query, hit);
    }
    void hit.then((m) => { if (!cancelled) setMinutes(m); });
    return () => {
      cancelled = true;
    };
  }, [query]);
  return minutes;
}
