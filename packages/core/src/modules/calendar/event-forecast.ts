// Weather on a calendar event (household feedback: "the travel, weather..."):
// the forecast for the event's hour, or its day for an all-day event, once
// it's within Open-Meteo's forecast range. Both apps ask /api/event-forecast,
// which geocodes the event's place and answers with an EventForecast; the
// reminder push adds the same text (supabase/functions/_shared/event-forecast.ts
// is this file's Deno twin, checked by event-forecast.test.ts).

import { conditionForWeatherCode } from '../../weather-tips';

/** How far ahead a forecast is worth showing; Open-Meteo forecasts 16 days. */
export const EVENT_FORECAST_DAYS = 14;

export interface EventForecast {
  weatherCode: number;
  /** At the event's hour; null for an all-day event. */
  tempC: number | null;
  highC: number;
  lowC: number;
  /** Chance of rain in %, at the hour or the day's highest. */
  precipProbability: number | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The local day (and hour, for a timed event) to forecast, or null when it's past or too far off. */
export function eventForecastRequest(
  event: { starts_at: string; is_all_day: boolean },
  now: Date = new Date()
): { date: string; hour: number | null } | null {
  const start = new Date(event.starts_at);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const daysAhead = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (daysAhead < 0 || daysAhead > EVENT_FORECAST_DAYS) return null;
  if (!event.is_all_day && start.getTime() < now.getTime() - 3_600_000) return null;
  return {
    date: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`,
    hour: event.is_all_day ? null : start.getHours(),
  };
}

/** Open-Meteo request for one local day at a place. */
export function openMeteoEventForecastUrl(lat: number, lng: number, date: string): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    start_date: date,
    end_date: date,
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The event's forecast out of an Open-Meteo answer for its day. */
export function pickEventForecast(raw: unknown, hour: number | null): EventForecast | null {
  const r = raw as {
    hourly?: { temperature_2m?: unknown[]; weather_code?: unknown[]; precipitation_probability?: unknown[] };
    daily?: {
      weather_code?: unknown[];
      temperature_2m_max?: unknown[];
      temperature_2m_min?: unknown[];
      precipitation_probability_max?: unknown[];
    };
  } | null;
  const highC = num(r?.daily?.temperature_2m_max?.[0]);
  const lowC = num(r?.daily?.temperature_2m_min?.[0]);
  const dayCode = num(r?.daily?.weather_code?.[0]);
  if (highC === null || lowC === null || dayCode === null) return null;
  if (hour !== null) {
    const tempC = num(r?.hourly?.temperature_2m?.[hour]);
    const code = num(r?.hourly?.weather_code?.[hour]);
    if (tempC !== null && code !== null) {
      return { weatherCode: code, tempC, highC, lowC, precipProbability: num(r?.hourly?.precipitation_probability?.[hour]) };
    }
  }
  return { weatherCode: dayCode, tempC: null, highC, lowC, precipProbability: num(r?.daily?.precipitation_probability_max?.[0]) };
}

/** Below this chance of rain it isn't worth mentioning. */
const RAIN_WORTH_SAYING_PCT = 30;

/** "19°, showers, 60% chance of rain" at the hour, or "14 to 22°, partly cloudy" for the day. */
export function eventForecastText(forecast: EventForecast): string {
  const temp =
    forecast.tempC !== null
      ? `${Math.round(forecast.tempC)}°`
      : `${Math.round(forecast.lowC)} to ${Math.round(forecast.highC)}°`;
  const label = conditionForWeatherCode(forecast.weatherCode).label.toLowerCase();
  const rain =
    forecast.precipProbability !== null && forecast.precipProbability >= RAIN_WORTH_SAYING_PCT
      ? `, ${Math.round(forecast.precipProbability)}% chance of rain`
      : '';
  return `${temp}, ${label}${rain}`;
}
