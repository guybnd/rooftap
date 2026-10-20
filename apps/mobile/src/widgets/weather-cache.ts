// HOUP-110: a small persisted cache of the last successfully-fetched weather
// reading, read by the widget's headless sync (use-widget-sync.ts) and its
// task handler. `useWeather`'s own cache (use-weather.ts) is in-memory and
// tied to the React component's lifetime — a headless widget task firing
// with the app process cold has nothing to read there. This uses the same
// SQLiteStorage('HomeUp.db') handle pattern as widget-snapshot.ts: opens
// synchronously, no StoreEnvironment prerequisite, safe to share the db file.
import { SQLiteStorage } from 'expo-sqlite/kv-store';
import type { WeatherData } from '@homeup/core';

const WEATHER_CACHE_KEY = 'homeup:widget:weather:v1';
// Distinct from useWeather's 45-min in-memory TTL (that's "still fresh enough
// to skip a live re-fetch this session"). This is "still worth showing to the
// user at all" — a much longer bar, since the widget's only alternative to a
// stale reading is no reading.
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

const sqliteStorage = new SQLiteStorage('HomeUp.db');

export interface CachedWeather {
  data: WeatherData;
  fetchedAt: string;
}

export function writeWeatherCache(data: WeatherData): void {
  const record: CachedWeather = { data, fetchedAt: new Date().toISOString() };
  sqliteStorage.setItemSync(WEATHER_CACHE_KEY, JSON.stringify(record));
}

export function readWeatherCache(): CachedWeather | null {
  const raw = sqliteStorage.getItemSync(WEATHER_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedWeather;
  } catch {
    return null;
  }
}

export function isWeatherStale(fetchedAt: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(fetchedAt).getTime() > STALE_AFTER_MS;
}
