// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeatherData } from '../weather-tips';
import { clearWeatherCacheForTests, useWeather } from './use-weather';

const reading: WeatherData = { tempC: 18, weatherCode: 2, highC: 21, lowC: 11 };

describe('useWeather', () => {
  beforeEach(() => clearWeatherCacheForTests());

  it('waits for a location', () => {
    const fetchWeather = vi.fn(async () => reading);
    const { result } = renderHook(() => useWeather(null, 151.2, fetchWeather));
    expect(result.current).toEqual({ data: null, error: false });
    expect(fetchWeather).not.toHaveBeenCalled();
  });

  it('fetches once, then serves the cached reading to the next caller nearby', async () => {
    const fetchWeather = vi.fn(async () => reading);
    const first = renderHook(() => useWeather(-33.8688, 151.2093, fetchWeather));
    await waitFor(() => expect(first.result.current.data).toEqual(reading));
    expect(fetchWeather).toHaveBeenCalledWith(-33.8688, 151.2093);

    // Same place rounded to two decimals: no second fetch.
    const second = renderHook(() => useWeather(-33.8701, 151.2121, fetchWeather));
    expect(second.result.current.data).toEqual(reading);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
  });

  it('reports a failed fetch', async () => {
    const fetchWeather = vi.fn(async () => {
      throw new Error('down');
    });
    const { result } = renderHook(() => useWeather(1, 2, fetchWeather));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('does not refetch when only the fetcher identity changes', async () => {
    const fetchWeather = vi.fn(async () => reading);
    const { result, rerender } = renderHook(({ f }) => useWeather(5, 6, f), { initialProps: { f: fetchWeather } });
    await waitFor(() => expect(result.current.data).toEqual(reading));
    rerender({ f: vi.fn(async () => reading) });
    expect(fetchWeather).toHaveBeenCalledTimes(1);
  });
});
