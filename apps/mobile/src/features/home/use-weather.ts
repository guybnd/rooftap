// The phone's binding for core's useWeather. /api/weather lives on apps/web's
// server, so this resolves the configured server's origin and sends the
// session token (the web middleware sends a tokenless /api request to
// /login, which made the "forecast" the login page).
import { useWeather as useCoreWeather, type WeatherData, type WeatherFetcher } from '@homeup/core';
import { getStoredServer } from '@/lib/server-config';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { writeWeatherCache } from '@/widgets/weather-cache';

export type { WeatherData };

const fetchWeather: WeatherFetcher = async (lat, lng) => {
  const server = await getStoredServer();
  if (!server) throw new Error('no server configured');
  const {
    data: { session },
  } = await getCurrentSupabaseClient().auth.getSession();
  const res = await fetch(`${server.origin}/api/weather?lat=${lat}&lng=${lng}`, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!res.ok) throw new Error('weather fetch failed');
  const result = (await res.json()) as WeatherData;
  // HOUP-110: also persist to the widget's durable cache. The in-memory cache
  // is lost on process restart, which is when a cold headless widget task
  // needs a reading most.
  writeWeatherCache(result);
  return result;
};

export function useWeather(lat: number | null, lng: number | null): { data: WeatherData | null; error: boolean } {
  return useCoreWeather(lat, lng, fetchWeather);
}
