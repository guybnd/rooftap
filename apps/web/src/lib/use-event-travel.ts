"use client";

import { useEffect, useState } from "react";
import type { EventLeg, TravelMode } from "@homeup/core";
import { useDataCache } from "@/lib/data-cache";

// Travel minutes from the household's home to an event's place, from
// /api/event-travel. `undefined` while unknown or loading, `null` when it
// couldn't be worked out. Answers are kept for the page's lifetime.

const cache = new Map<string, Promise<number | null>>();

export interface EventTravel {
  /** The household's home is set, so travel can be worked out. */
  hasHome: boolean;
  minutes: number | null | undefined;
}

export function useEventTravel(place: string, mode: TravelMode | null, debounceMs = 600): EventTravel {
  const { group } = useDataCache();
  const [minutes, setMinutes] = useState<number | null | undefined>(undefined);
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

  useEffect(() => {
    setMinutes(undefined);
    if (!query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      let hit = cache.get(query);
      if (!hit) {
        hit = fetch(`/api/event-travel?${query}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => (typeof data?.minutes === "number" ? data.minutes : null))
          .catch(() => null);
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
  const [minutes, setMinutes] = useState<number | null | undefined>(undefined);
  const query = leg ? new URLSearchParams({ place: leg.to, mode: leg.mode, from: leg.from }).toString() : null;
  useEffect(() => {
    setMinutes(undefined);
    if (!query) return;
    let cancelled = false;
    let hit = cache.get(query);
    if (!hit) {
      hit = fetch(`/api/event-travel?${query}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => (typeof data?.minutes === "number" ? data.minutes : null))
        .catch(() => null);
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
