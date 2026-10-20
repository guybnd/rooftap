"use client";

import { useEffect, useState } from "react";
import { eventForecastRequest, eventForecastText, type EventForecast } from "@homeup/core";
import { useDataCache } from "@/lib/data-cache";

// The forecast line for a calendar event within range, from /api/event-forecast
// (which geocodes the place; the household's home stands in without one).
// Answers are kept for the page's lifetime, keyed by place and hour.

const cache = new Map<string, Promise<EventForecast | null>>();

function fetchForecast(query: string): Promise<EventForecast | null> {
  let hit = cache.get(query);
  if (!hit) {
    hit = fetch(`/api/event-forecast?${query}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data?.forecast as EventForecast | null) ?? null)
      .catch(() => null);
    // A failed lookup shouldn't stick for the page's lifetime.
    void hit.then((f) => { if (!f) cache.delete(query); });
    cache.set(query, hit);
  }
  return hit;
}

export function useEventForecast(
  event: { starts_at: string; is_all_day: boolean; location: string | null } | null,
  debounceMs = 0
): string | null {
  const { group } = useDataCache();
  const [text, setText] = useState<string | null>(null);

  const request = event ? eventForecastRequest(event) : null;
  const params = new URLSearchParams();
  if (request) {
    params.set("date", request.date);
    if (request.hour !== null) params.set("hour", String(request.hour));
    if (event?.location?.trim()) params.set("place", event.location.trim());
    if (group?.home_lat != null && group?.home_lng != null) {
      params.set("lat", String(group.home_lat));
      params.set("lng", String(group.home_lng));
    }
  }
  const query = request ? params.toString() : null;

  useEffect(() => {
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
