'use client';

// Home's weather, shared by both apps: one fetch per rounded location, kept in
// a 45-minute in-memory cache so the sky block, the tips and the week board
// read the same reading. Each app passes how it reaches /api/weather (web
// fetches it relative, the phone resolves its server and sends its token).

import { useEffect, useRef, useState } from 'react';
import type { WeatherData } from '../weather-tips';

const CACHE_TTL_MS = 45 * 60 * 1000;
const cache = new Map<string, { data: WeatherData; expiresAt: number }>();

/** Fetches the forecast for a location; throws when it can't. */
export type WeatherFetcher = (lat: number, lng: number) => Promise<WeatherData>;

export function useWeather(
  lat: number | null,
  lng: number | null,
  fetchWeather: WeatherFetcher
): { data: WeatherData | null; error: boolean } {
  const [data, setData] = useState<WeatherData | null>(null);
  const [error, setError] = useState(false);
  // The fetcher is usually an inline closure; only a new location refetches.
  const fetchRef = useRef(fetchWeather);
  fetchRef.current = fetchWeather;

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
        const result = await fetchRef.current(lat, lng);
        if (cancelled) return;
        cache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
        setData(result);
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

/** Test seam: forget every cached reading. */
export function clearWeatherCacheForTests(): void {
  cache.clear();
}
