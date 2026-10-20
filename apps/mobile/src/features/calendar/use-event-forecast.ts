// The forecast line for a calendar event within range: native side of
// apps/web/src/lib/use-event-forecast.ts. /api/event-forecast geocodes the
// place (the household's home stands in without one); the request carries the
// session's Bearer token like calendar-api.ts. Answers are kept per app run.
import * as React from 'react';
import { eventForecastRequest, eventForecastText, type EventForecast } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

const cache = new Map<string, Promise<EventForecast | null>>();

async function load(query: string): Promise<EventForecast | null> {
  const server = await getStoredServer();
  if (!server) return null;
  const {
    data: { session },
  } = await getCurrentSupabaseClient().auth.getSession();
  const res = await fetch(`${server.origin}/api/event-forecast?${query}`, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data?.forecast as EventForecast | null) ?? null;
}

function fetchForecast(query: string): Promise<EventForecast | null> {
  let hit = cache.get(query);
  if (!hit) {
    hit = load(query).catch(() => null);
    // A failed lookup shouldn't stick for the whole run.
    hit.then((f) => { if (!f) cache.delete(query); });
    cache.set(query, hit);
  }
  return hit;
}

export function useEventForecast(
  event: { starts_at: string; is_all_day: boolean; location: string | null } | null,
  debounceMs = 0
): string | null {
  const { group } = useDataCache();
  const [text, setText] = React.useState<string | null>(null);

  const request = event ? eventForecastRequest(event) : null;
  let query: string | null = null;
  if (request) {
    const params = new URLSearchParams({ date: request.date });
    if (request.hour !== null) params.set('hour', String(request.hour));
    if (event?.location?.trim()) params.set('place', event.location.trim());
    if (group?.home_lat != null && group?.home_lng != null) {
      params.set('lat', String(group.home_lat));
      params.set('lng', String(group.home_lng));
    }
    query = params.toString();
  }

  React.useEffect(() => {
    if (!query) {
      setText(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchForecast(query).then((forecast) => {
        if (!cancelled) setText(forecast ? eventForecastText(forecast) : null);
      });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, debounceMs]);

  return text;
}
