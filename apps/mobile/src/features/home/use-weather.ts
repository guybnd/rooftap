// HOUP-85: native counterpart of apps/web's app/home/use-weather.ts. Same
// /api/weather contract and 45-min client cache, but this endpoint lives on
// apps/web's Next.js server — native has no relative-fetch origin, so this
// resolves the configured server's absolute origin via getStoredServer()
// (the same pairing app/index.tsx and server-config.ts already use for
// /api/public-config) instead of a bare fetch('/api/weather?...').
import { useEffect, useState } from 'react';
import type { WeatherData } from '@homeup/core';
import { getStoredServer } from '@/lib/server-config';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { writeWeatherCache } from '@/widgets/weather-cache';

export type { WeatherData };

const CACHE_TTL_MS = 45 * 60 * 1000;
const cache = new Map<string, { data: WeatherData; expiresAt: number }>();

export function useWeather(lat: number | null, lng: number | null): { data: WeatherData | null; error: boolean } {
  const [data, setData] = useState<WeatherData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (lat == null || lng == null) return;

    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      setData(cached.data);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const server = await getStoredServer();
        if (!server) throw new Error('no server configured');
        // The web middleware sends any /api request without a cookie or a
        // Bearer token to /login, so the token goes along (same as
        // geocode-api.ts); without it the "forecast" was the login page.
        const {
          data: { session },
        } = await getCurrentSupabaseClient().auth.getSession();
        const res = await fetch(`${server.origin}/api/weather?lat=${lat}&lng=${lng}`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!res.ok) throw new Error('weather fetch failed');
        const result = (await res.json()) as WeatherData;
        if (cancelled) return;
        cache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
        setData(result);
        // HOUP-110: also persist to the widget's durable cache — this
        // in-memory Map is lost on process restart, which is exactly when a
        // cold headless widget task needs a reading most.
        writeWeatherCache(result);
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return { data, error };
}
