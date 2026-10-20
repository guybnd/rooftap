// HOUP-85: maps @homeup/core's platform-agnostic WeatherCondition to a
// lucide-react-native icon (core can't hold either lucide flavor directly —
// see weather-tips.ts's header comment).
import { Sun, Cloud, CloudSun, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning, type LucideIcon } from 'lucide-react-native';
import { conditionForWeatherCode, type WeatherCondition } from '@homeup/core';

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

export function iconAndLabelForCode(code: number): { Icon: LucideIcon; label: string } {
  const { condition, label } = conditionForWeatherCode(code);
  return { Icon: ICONS[condition], label };
}
