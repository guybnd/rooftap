'use client';

// ── FLUX-242: shared weather fetch + client cache for the /home hub ─────────────
// Extracted from the retired weather-tile.tsx so the summary hero (and anything
// else that needs current weather) can reuse the same fetch/cache/icon logic
// instead of duplicating it.

import { useEffect, useState } from 'react';
import { Sun, Cloud, CloudSun, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning, type LucideIcon } from 'lucide-react';

export interface WeatherData {
  tempC: number;
  weatherCode: number;
  highC: number;
  lowC: number;
  /** FLUX-256: soft-optional — a missing field degrades one tip, not the whole payload. */
  humidity?: number;
  windSpeedKmh?: number;
  /** ISO local-time string (Open-Meteo `timezone=auto`), e.g. "2026-07-23T19:42". */
  sunset?: string;
  uvIndexMax?: number;
  hourly?: {
    /** ISO local-time strings, one per hour of today. */
    times: string[];
    precipitation: number[];
    precipitationProbability: number[];
    uvIndex: number[];
  };
  /** The next 12 hours from the current hour, for the day ribbon (core WeatherData.ahead). */
  ahead?: {
    times: string[];
    tempC: number[];
    precipitationProbability: number[];
  };
}

const CACHE_TTL_MS = 45 * 60 * 1000;
const cache = new Map<string, { data: WeatherData; expiresAt: number }>();

// WMO weather codes (https://open-meteo.com/en/docs) collapsed to a small icon set.
export function iconAndLabelForCode(code: number): { Icon: LucideIcon; label: string } {
  if (code === 0) return { Icon: Sun, label: 'Clear' };
  if (code <= 2) return { Icon: CloudSun, label: 'Partly cloudy' };
  if (code === 3) return { Icon: Cloud, label: 'Overcast' };
  if (code <= 48) return { Icon: CloudFog, label: 'Foggy' };
  if (code <= 57) return { Icon: CloudDrizzle, label: 'Drizzle' };
  if (code <= 67) return { Icon: CloudRain, label: 'Rain' };
  if (code <= 77) return { Icon: CloudSnow, label: 'Snow' };
  if (code <= 82) return { Icon: CloudRain, label: 'Showers' };
  if (code <= 86) return { Icon: CloudSnow, label: 'Snow showers' };
  if (code <= 99) return { Icon: CloudLightning, label: 'Thunderstorm' };
  return { Icon: Cloud, label: 'Cloudy' };
}

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
        const res = await fetch(`/api/weather?lat=${lat}&lng=${lng}`);
        if (!res.ok) throw new Error('weather fetch failed');
        const result = (await res.json()) as WeatherData;
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
