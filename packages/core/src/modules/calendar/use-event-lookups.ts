'use client';

// The forecast line and the travel minutes for a calendar event, shared by
// both apps. Each app makes one createEventLookups with its own `get` (web's
// fetch, or native's absolute-origin fetch with the Bearer token) and binds
// the hooks below to its household's home. Answers are kept for the app's
// run, keyed by query; a failed lookup is dropped so it can be asked again.

import { useEffect, useState } from 'react';
import { eventForecastRequest, eventForecastText, type EventForecast } from './event-forecast';
import type { EventLeg } from './event-legs';
import type { TravelMode } from './event-travel';

/** The app's GET: resolves to the parsed JSON body, or null when the response wasn't ok. */
export type EventLookupGet = (path: string) => Promise<unknown>;

/** The household's home, where a trip starts and the forecast falls back to. */
export type EventLookupHome = { home_lat: number | null; home_lng: number | null } | null | undefined;

function cachedLoader<T>(get: EventLookupGet, path: string, read: (data: unknown) => T | null) {
  const cache = new Map<string, Promise<T | null>>();
  return (query: string): Promise<T | null> => {
    let hit = cache.get(query);
    if (!hit) {
      hit = get(`${path}?${query}`)
        .then((data) => read(data))
        .catch(() => null);
      void hit.then((value) => {
        if (value === null) cache.delete(query);
      });
      cache.set(query, hit);
    }
    return hit;
  };
}

export function createEventLookups(get: EventLookupGet) {
  return {
    forecast: cachedLoader<EventForecast>(
      get,
      '/api/event-forecast',
      (data) => ((data as { forecast?: EventForecast | null } | null)?.forecast ?? null)
    ),
    travel: cachedLoader<number>(get, '/api/event-travel', (data) => {
      const minutes = (data as { minutes?: unknown } | null)?.minutes;
      return typeof minutes === 'number' ? minutes : null;
    }),
  };
}

export type EventLookups = ReturnType<typeof createEventLookups>;

const homeIsSet = (home: EventLookupHome): home is { home_lat: number; home_lng: number } =>
  home?.home_lat != null && home?.home_lng != null;

/** The forecast query for an event within range, or null when there is nothing to ask. */
export function eventForecastQuery(
  event: { starts_at: string; is_all_day: boolean; location: string | null } | null,
  home: EventLookupHome
): string | null {
  const request = event ? eventForecastRequest(event) : null;
  if (!request) return null;
  const params = new URLSearchParams({ date: request.date });
  if (request.hour !== null) params.set('hour', String(request.hour));
  if (event?.location?.trim()) params.set('place', event.location.trim());
  if (homeIsSet(home)) {
    params.set('lat', String(home.home_lat));
    params.set('lng', String(home.home_lng));
  }
  return params.toString();
}

/** The forecast line for an event within range (the place's, else home's), or null. */
export function useEventForecastText(
  lookups: EventLookups,
  event: { starts_at: string; is_all_day: boolean; location: string | null } | null,
  home: EventLookupHome,
  debounceMs = 0
): string | null {
  const [text, setText] = useState<string | null>(null);
  const query = eventForecastQuery(event, home);

  useEffect(() => {
    if (!query) {
      setText(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void lookups.forecast(query).then((forecast) => {
        if (!cancelled) setText(forecast ? eventForecastText(forecast) : null);
      });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lookups, query, debounceMs]);

  return text;
}

export interface EventTravel {
  /** The household's home is set, so travel can be worked out. */
  hasHome: boolean;
  /** `undefined` while unknown or loading, `null` when it couldn't be worked out. */
  minutes: number | null | undefined;
}

/** Travel minutes from home to an event's place by `mode`. */
export function useEventTravelMinutes(
  lookups: EventLookups,
  place: string,
  mode: TravelMode | null,
  home: EventLookupHome,
  debounceMs = 600
): EventTravel {
  const [minutes, setMinutes] = useState<number | null | undefined>(undefined);
  const hasHome = homeIsSet(home);
  const query =
    homeIsSet(home) && mode && place.trim()
      ? new URLSearchParams({
          place: place.trim(),
          mode,
          from_lat: String(home.home_lat),
          from_lng: String(home.home_lng),
        }).toString()
      : null;

  useEffect(() => {
    setMinutes(undefined);
    if (!query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void lookups.travel(query).then((m) => {
        if (!cancelled) setMinutes(m);
      });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lookups, query, debounceMs]);

  return { hasHome, minutes };
}

/** Travel minutes for a leg between two events (event-legs.ts), same states as above. */
export function useLegTravelMinutes(lookups: EventLookups, leg: EventLeg | null): number | null | undefined {
  const [minutes, setMinutes] = useState<number | null | undefined>(undefined);
  const query = leg ? new URLSearchParams({ place: leg.to, mode: leg.mode, from: leg.from }).toString() : null;
  useEffect(() => {
    setMinutes(undefined);
    if (!query) return;
    let cancelled = false;
    void lookups.travel(query).then((m) => {
      if (!cancelled) setMinutes(m);
    });
    return () => {
      cancelled = true;
    };
  }, [lookups, query]);
  return minutes;
}
