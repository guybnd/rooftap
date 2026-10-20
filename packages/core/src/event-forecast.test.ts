import { describe, expect, it } from 'vitest';
import {
  eventForecastRequest,
  eventForecastText,
  openMeteoEventForecastUrl,
  pickEventForecast,
} from './event-forecast';
import { conditionForWeatherCode } from './weather-tips';
// The reminder push's Deno twin.
import * as twin from '../../../supabase/functions/_shared/event-forecast';

const hourly = (n: number, v: (i: number) => number) => Array.from({ length: 24 }, (_, i) => (i === n ? v(i) : 0));
const RAW = {
  hourly: {
    temperature_2m: hourly(19, () => 18.6),
    weather_code: hourly(19, () => 80),
    precipitation_probability: hourly(19, () => 60),
  },
  daily: { weather_code: [2], temperature_2m_max: [22.4], temperature_2m_min: [13.6], precipitation_probability_max: [10] },
};

describe('eventForecastRequest', () => {
  const now = new Date(2026, 9, 19, 9, 0);
  it('asks for the event hour within range', () => {
    expect(eventForecastRequest({ starts_at: new Date(2026, 9, 26, 19, 30).toISOString(), is_all_day: false }, now)).toEqual({
      date: '2026-10-26',
      hour: 19,
    });
    expect(eventForecastRequest({ starts_at: new Date(2026, 9, 20).toISOString(), is_all_day: true }, now)).toEqual({
      date: '2026-10-20',
      hour: null,
    });
  });
  it('skips past and far-off events', () => {
    expect(eventForecastRequest({ starts_at: new Date(2026, 9, 18, 19).toISOString(), is_all_day: false }, now)).toBeNull();
    expect(eventForecastRequest({ starts_at: new Date(2026, 10, 30, 19).toISOString(), is_all_day: false }, now)).toBeNull();
  });
});

describe('pickEventForecast and eventForecastText', () => {
  it('reads the event hour', () => {
    const f = pickEventForecast(RAW, 19)!;
    expect(f).toEqual({ weatherCode: 80, tempC: 18.6, highC: 22.4, lowC: 13.6, precipProbability: 60 });
    expect(eventForecastText(f)).toBe('19°, showers, 60% chance of rain');
  });
  it('reads the day for an all-day event, leaving low rain chances unsaid', () => {
    expect(eventForecastText(pickEventForecast(RAW, null)!)).toBe('14 to 22°, partly cloudy');
  });
  it('gives up on an incomplete answer', () => {
    expect(pickEventForecast({ daily: {} }, 19)).toBeNull();
    expect(twin.eventForecastTextFrom({ daily: {} }, 19)).toBeNull();
  });
});

describe('the push twin', () => {
  it('builds the same request and text', () => {
    expect(twin.openMeteoEventForecastUrl(-37.8, 144.95, '2026-10-26')).toBe(openMeteoEventForecastUrl(-37.8, 144.95, '2026-10-26'));
    for (const hour of [19, null]) {
      expect(twin.eventForecastTextFrom(RAW, hour)).toBe(eventForecastText(pickEventForecast(RAW, hour)!));
    }
  });
  it('labels every weather code the same way', () => {
    for (let code = 0; code <= 100; code++) {
      const raw = { daily: { weather_code: [code], temperature_2m_max: [20], temperature_2m_min: [10], precipitation_probability_max: [0] } };
      expect(twin.eventForecastTextFrom(raw, null)).toBe(`10 to 20°, ${conditionForWeatherCode(code).label.toLowerCase()}`);
    }
  });
});
