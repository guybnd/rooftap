// HOUP-110 review follow-up: weather-cache.ts had no coverage. This is the
// only source a cold headless widget task has for a weather reading (the
// in-memory cache in use-weather.ts dies with the React tree), so its
// write/read/stale-threshold behavior is worth locking down directly.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeatherData } from '@homeup/core';

const sqliteData = new Map<string, string>();
vi.mock('expo-sqlite/kv-store', () => ({
  SQLiteStorage: class {
    getItemSync(key: string) {
      return sqliteData.get(key) ?? null;
    }
    setItemSync(key: string, value: string) {
      sqliteData.set(key, value);
    }
  },
}));

function weather(overrides: Partial<WeatherData> = {}): WeatherData {
  return { tempC: 18, weatherCode: 1, highC: 22, lowC: 12, ...overrides };
}

describe('weather-cache', () => {
  beforeEach(() => {
    vi.resetModules();
    sqliteData.clear();
  });

  it('readWeatherCache returns null when nothing has ever been written', async () => {
    const { readWeatherCache } = await import('./weather-cache');
    expect(readWeatherCache()).toBeNull();
  });

  it('round-trips a write through a read', async () => {
    const { writeWeatherCache, readWeatherCache } = await import('./weather-cache');
    const data = weather({ tempC: 22.5 });

    writeWeatherCache(data);
    const cached = readWeatherCache();

    expect(cached?.data).toEqual(data);
    expect(typeof cached?.fetchedAt).toBe('string');
  });

  it('a later write overwrites the earlier cached reading', async () => {
    const { writeWeatherCache, readWeatherCache } = await import('./weather-cache');

    writeWeatherCache(weather({ tempC: 10 }));
    writeWeatherCache(weather({ tempC: 30 }));

    expect(readWeatherCache()?.data.tempC).toBe(30);
  });

  it('readWeatherCache returns null for corrupt stored JSON instead of throwing', async () => {
    sqliteData.set('homeup:widget:weather:v1', 'not-json');
    const { readWeatherCache } = await import('./weather-cache');

    expect(readWeatherCache()).toBeNull();
  });

  describe('isWeatherStale', () => {
    it('is false just under the 3h threshold', async () => {
      const { isWeatherStale } = await import('./weather-cache');
      const fetchedAt = '2026-08-01T00:00:00.000Z';
      const now = new Date('2026-08-01T02:59:59.999Z');

      expect(isWeatherStale(fetchedAt, now)).toBe(false);
    });

    it('flips true once the 3h threshold has passed', async () => {
      const { isWeatherStale } = await import('./weather-cache');
      const fetchedAt = '2026-08-01T00:00:00.000Z';
      const now = new Date('2026-08-01T03:00:00.001Z');

      expect(isWeatherStale(fetchedAt, now)).toBe(true);
    });
  });
});
