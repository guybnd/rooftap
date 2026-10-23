'use client';

// FLUX-242: web's binding for core's useWeather (one fetch + 45-minute cache
// per location, shared by the summary hero and the week board). Web reaches
// /api/weather relative to its own origin.

import { Sun, Cloud, CloudSun, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning, type LucideIcon } from 'lucide-react';
import {
  conditionForWeatherCode,
  useWeather as useCoreWeather,
  type WeatherCondition,
  type WeatherData,
  type WeatherFetcher,
} from '@homeup/core';

export type { WeatherData };

const fetchWeather: WeatherFetcher = async (lat, lng) => {
  const res = await fetch(`/api/weather?lat=${lat}&lng=${lng}`);
  if (!res.ok) throw new Error('weather fetch failed');
  return (await res.json()) as WeatherData;
};

export function useWeather(lat: number | null, lng: number | null): { data: WeatherData | null; error: boolean } {
  return useCoreWeather(lat, lng, fetchWeather);
}

const ICONS: Record<WeatherCondition, LucideIcon> = {
  clear: Sun,
  'partly-cloudy': CloudSun,
  foggy: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  showers: CloudRain,
  'snow-showers': CloudSnow,
  thunderstorm: CloudLightning,
  cloudy: Cloud,
};

/** WMO weather code to a lucide icon and label (core conditionForWeatherCode). */
export function iconAndLabelForCode(code: number): { Icon: LucideIcon; label: string } {
  const { condition, label } = conditionForWeatherCode(code);
  return { Icon: ICONS[condition], label };
}
