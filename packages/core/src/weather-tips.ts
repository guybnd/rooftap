// HOUP-85: pure weather-tip condition logic shared by both platforms' hero
// modules. Ported from apps/web/src/app/home/{use-weather,weather-tips}.ts,
// with one deliberate contract change: web's `weatherRecommendation` returns
// a lucide-react `Icon` component directly, which this module can't do
// (packages/core has zero UI deps — web uses lucide-react, native uses
// lucide-react-native). Callers map the returned `kind` to their own icon.
// apps/web's own weather-tips.ts is left untouched (lower regression risk
// than also migrating its Icon-returning contract in this pass).

import { formatTime12h } from './date-utils';

export interface WeatherData {
  tempC: number;
  weatherCode: number;
  highC: number;
  lowC: number;
  /** Soft-optional — a missing field degrades one tip, not the whole payload. */
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
  /**
   * The next 12 hours from the current hour (crossing midnight), for Home's
   * day ribbon. Soft-optional: a server or cache that predates it just
   * leaves the ribbon out.
   */
  ahead?: {
    /** ISO local-time strings, e.g. "2026-10-19T16:00". The first is the current hour. */
    times: string[];
    tempC: number[];
    precipitationProbability: number[];
  };
}

export const RAIN_CODES = new Set([51, 52, 53, 54, 55, 56, 57, 61, 62, 63, 64, 65, 66, 67, 80, 81, 82, 95, 96, 97, 98, 99]);
export const SNOW_CODES = new Set([71, 72, 73, 74, 75, 76, 77, 85, 86]);


/** Index into `times` (one entry per hour of today) matching `now`'s local hour, clamped defensively. */
function hourlyIndexForNow(times: string[], now: Date): number {
  const targetHour = now.getHours();
  const idx = times.findIndex((t) => Number(t.slice(11, 13)) === targetHour);
  return idx >= 0 ? idx : Math.min(targetHour, times.length - 1);
}

const RAIN_LATER_PROBABILITY_PCT = 50;
const RAIN_LATER_MIN_MM = 0.2;

/**
 * Formatted time of the next hour (after now) where rain is likely, or null
 * if it's already raining/snowing now, there's no hourly series, or nothing
 * qualifies in the rest of today.
 */
export function rainLaterLabel(weather: WeatherData, now: Date): string | null {
  if (RAIN_CODES.has(weather.weatherCode) || SNOW_CODES.has(weather.weatherCode)) return null;
  const hourly = weather.hourly;
  if (!hourly) return null;
  const nowIdx = hourlyIndexForNow(hourly.times, now);
  for (let i = nowIdx + 1; i < hourly.times.length; i++) {
    const prob = hourly.precipitationProbability[i];
    const amount = hourly.precipitation[i];
    if ((typeof prob === 'number' && prob >= RAIN_LATER_PROBABILITY_PCT) || (typeof amount === 'number' && amount >= RAIN_LATER_MIN_MM)) {
      return formatTime12h(hourly.times[i].slice(11, 16));
    }
  }
  return null;
}

export type WeatherTipKind = 'rain' | 'snow' | 'hot' | 'cold';

// rain-later branch reads the hourly precip series so the tip fires at most
// one line — dry-now-but-rain-later and raining-now can never both render
// (single module, first-match-wins).
export function weatherRecommendation({
  weatherCode,
  tempC,
  rainLaterLabel,
}: {
  weatherCode: number;
  tempC: number;
  rainLaterLabel: string | null;
}): { text: string; kind: WeatherTipKind } | null {
  if (RAIN_CODES.has(weatherCode)) return { text: 'Rain expected, bring an umbrella', kind: 'rain' };
  if (SNOW_CODES.has(weatherCode)) return { text: 'Cold and snowy, grab a jacket', kind: 'snow' };
  if (rainLaterLabel) return { text: `Clear now. Rain from ${rainLaterLabel}, grab an umbrella`, kind: 'rain' };
  // Sunscreen advice lives in `tipUv` (reads actual UV, not a temp proxy) — this keeps only the hydration half.
  if (tempC >= 28) return { text: 'Hot today, stay hydrated', kind: 'hot' };
  if (tempC <= 5) return { text: 'Cold today, grab a jacket', kind: 'cold' };
  return null;
}

export const UV_HIGH_THRESHOLD = 6;

/** Current-hour UV index (falls back to today's daily max when hourly is unavailable). */
export function currentUvIndex(weather: WeatherData, now: Date): number | null {
  if (weather.hourly) {
    const idx = hourlyIndexForNow(weather.hourly.times, now);
    const val = weather.hourly.uvIndex[idx];
    if (typeof val === 'number') return val;
  }
  return typeof weather.uvIndexMax === 'number' ? weather.uvIndexMax : null;
}

const DRYING_MAX_WEATHER_CODE = 3; // WMO 0-3: clear/mainly clear/partly cloudy/overcast
const DRYING_HUMIDITY_MAX_PCT = 60;
const DRYING_WIND_MIN_KMH = 5;
const DRYING_WIND_MAX_KMH = 25;

/** Clear-ish + dry + breezy + no rain forecast for the rest of today. */
export function isDryingDay(weather: WeatherData, now: Date): boolean {
  if (weather.weatherCode > DRYING_MAX_WEATHER_CODE) return false;
  if (typeof weather.humidity !== 'number' || weather.humidity >= DRYING_HUMIDITY_MAX_PCT) return false;
  if (
    typeof weather.windSpeedKmh !== 'number' ||
    weather.windSpeedKmh < DRYING_WIND_MIN_KMH ||
    weather.windSpeedKmh > DRYING_WIND_MAX_KMH
  ) {
    return false;
  }
  if (weather.hourly) {
    const nowIdx = hourlyIndexForNow(weather.hourly.times, now);
    for (let i = nowIdx; i < weather.hourly.precipitation.length; i++) {
      if ((weather.hourly.precipitation[i] ?? 0) > 0) return false;
    }
  }
  return true;
}

const GOLDEN_HOUR_OFFSET_MIN = 37;

function minutesFromTimeString(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function timeStringFromMinutes(totalMin: number): string {
  const wrapped = ((totalMin % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Sunset + golden-hour (fixed offset before sunset), both formatted 12h local. */
export function sunsetInfo(weather: WeatherData): { sunset: string; goldenHour: string } | null {
  if (!weather.sunset) return null;
  const sunsetHHMM = weather.sunset.slice(11, 16);
  const goldenHHMM = timeStringFromMinutes(minutesFromTimeString(sunsetHHMM) - GOLDEN_HOUR_OFFSET_MIN);
  return { sunset: formatTime12h(sunsetHHMM), goldenHour: formatTime12h(goldenHHMM) };
}

/** WMO weather codes (https://open-meteo.com/en/docs) collapsed to a small condition set. Icon selection stays with the caller (platform-specific). */
export type WeatherCondition = 'clear' | 'partly-cloudy' | 'foggy' | 'drizzle' | 'rain' | 'snow' | 'showers' | 'snow-showers' | 'thunderstorm' | 'cloudy';

export function conditionForWeatherCode(code: number): { condition: WeatherCondition; label: string } {
  if (code === 0) return { condition: 'clear', label: 'Clear' };
  if (code <= 2) return { condition: 'partly-cloudy', label: 'Partly cloudy' };
  if (code === 3) return { condition: 'cloudy', label: 'Overcast' };
  if (code <= 48) return { condition: 'foggy', label: 'Foggy' };
  if (code <= 57) return { condition: 'drizzle', label: 'Drizzle' };
  if (code <= 67) return { condition: 'rain', label: 'Rain' };
  if (code <= 77) return { condition: 'snow', label: 'Snow' };
  if (code <= 82) return { condition: 'showers', label: 'Showers' };
  if (code <= 86) return { condition: 'snow-showers', label: 'Snow showers' };
  if (code <= 99) return { condition: 'thunderstorm', label: 'Thunderstorm' };
  return { condition: 'cloudy', label: 'Cloudy' };
}

// ── Home day ribbon (Hearth v2, Pulse) ───────────────────────────────────────
// The rest of the day as one hourly strip under Home's Hero: rain chance as
// bars, the current hour marked, an hour with a timed item gets a dot, and the
// sunset hour is flagged. Both apps render it from these helpers.

/** Storage key for whether the ribbon is expanded (per device; SecureStore-safe characters). */
export const SKY_RIBBON_OPEN_STORAGE_KEY = 'home_sky_ribbon_open';

/** Rain chance at or above this reads as "likely" (solid bar), matching rainLaterLabel. */
export const RIBBON_RAIN_LIKELY_PCT = RAIN_LATER_PROBABILITY_PCT;

export interface RibbonHour {
  /** "YYYY-MM-DDTHH", unique per column. */
  key: string;
  /** "Now" for the first column, then "2p", "11a". */
  label: string;
  isNow: boolean;
  /** Rounded temperature, shown on every third column (and the first). */
  tempC: number | null;
  showTemp: boolean;
  /** 0-100. */
  precipitationProbability: number;
  rainLikely: boolean;
  /** A timed item falls in this hour. */
  hasItem: boolean;
  /** Sunset falls in this hour. */
  isSunset: boolean;
}

function shortHourLabel(hour: number): string {
  const suffix = hour < 12 ? 'a' : 'p';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${suffix}`;
}

/**
 * Columns for the ribbon, from `weather.ahead`. `itemTimes` are the timed
 * items to dot, as "YYYY-MM-DDTHH:MM" local strings. Returns [] when the
 * payload has no `ahead` series, so callers can hide the ribbon.
 */
export function buildDayRibbon(weather: WeatherData, itemTimes: string[] = []): RibbonHour[] {
  const ahead = weather.ahead;
  if (!ahead || ahead.times.length === 0) return [];
  const itemHours = new Set(itemTimes.map((t) => t.slice(0, 13)));
  const sunsetHour = weather.sunset ? weather.sunset.slice(0, 13) : null;
  return ahead.times.map((time, i) => {
    const key = time.slice(0, 13);
    const temp = ahead.tempC[i];
    const prob = ahead.precipitationProbability[i];
    const probability = typeof prob === 'number' ? Math.max(0, Math.min(100, prob)) : 0;
    return {
      key,
      label: i === 0 ? 'Now' : shortHourLabel(Number(time.slice(11, 13))),
      isNow: i === 0,
      tempC: typeof temp === 'number' ? Math.round(temp) : null,
      showTemp: i % 3 === 0 && typeof temp === 'number',
      precipitationProbability: probability,
      rainLikely: probability >= RIBBON_RAIN_LIKELY_PCT,
      hasItem: itemHours.has(key),
      isSunset: key === sunsetHour,
    };
  });
}

/**
 * One short line for the weather block beside the Hero: what the sky is about
 * to do. Rain wins (now, or the first likely hour ahead), else the condition.
 */
export function skyHeadline(weather: WeatherData, now: Date): { text: string; rain: boolean } {
  if (RAIN_CODES.has(weather.weatherCode)) return { text: 'Raining now', rain: true };
  if (SNOW_CODES.has(weather.weatherCode)) return { text: 'Snowing now', rain: true };
  const ahead = weather.ahead;
  if (ahead) {
    for (let i = 1; i < ahead.times.length; i++) {
      const prob = ahead.precipitationProbability[i];
      if (typeof prob === 'number' && prob >= RAIN_LATER_PROBABILITY_PCT) {
        return { text: `Rain at ${shortHourLabel(Number(ahead.times[i].slice(11, 13)))}m`, rain: true };
      }
    }
  } else {
    const later = rainLaterLabel(weather, now);
    if (later) return { text: `Rain at ${later}`, rain: true };
  }
  return { text: conditionForWeatherCode(weather.weatherCode).label, rain: false };
}

/** Screen-reader summary of the ribbon: the rain window, if any, and sunset. */
export function describeDayRibbon(hours: RibbonHour[]): string {
  const parts = [`Next ${hours.length} hours`];
  const firstRain = hours.find((h) => h.rainLikely);
  parts.push(firstRain ? `rain likely from ${firstRain.isNow ? 'now' : firstRain.label}` : 'no rain likely');
  const sunset = hours.find((h) => h.isSunset);
  if (sunset) parts.push(`sunset around ${sunset.label}`);
  return parts.join(', ');
}
