import { describe, expect, it } from "vitest";
import { rainLaterLabel, currentUvIndex, isDryingDay, sunsetInfo } from "./weather-tips";
import type { WeatherData } from "./use-weather";

const DATE = "2026-07-23";
const NOON = new Date(`${DATE}T12:00:00`);

function hourlyTimes(): string[] {
  return Array.from({ length: 24 }, (_, h) => `${DATE}T${String(h).padStart(2, "0")}:00`);
}

function baseWeather(overrides: Partial<WeatherData> = {}): WeatherData {
  return {
    tempC: 20,
    weatherCode: 1,
    highC: 24,
    lowC: 14,
    ...overrides,
  };
}

describe("rainLaterLabel (FLUX-256)", () => {
  it("returns null when it is already raining/snowing now", () => {
    const weather = baseWeather({
      weatherCode: 61, // rain
      hourly: {
        times: hourlyTimes(),
        precipitation: hourlyTimes().map(() => 5),
        precipitationProbability: hourlyTimes().map(() => 90),
        uvIndex: hourlyTimes().map(() => 0),
      },
    });
    expect(rainLaterLabel(weather, NOON)).toBeNull();
  });

  it("returns null when no hourly series is present", () => {
    expect(rainLaterLabel(baseWeather(), NOON)).toBeNull();
  });

  it("finds the first qualifying hour after now by probability threshold", () => {
    const precipitationProbability = hourlyTimes().map((_, h) => (h === 15 ? 70 : 5));
    const weather = baseWeather({
      weatherCode: 1, // dry now (partly cloudy)
      hourly: {
        times: hourlyTimes(),
        precipitation: hourlyTimes().map(() => 0),
        precipitationProbability,
        uvIndex: hourlyTimes().map(() => 0),
      },
    });
    expect(rainLaterLabel(weather, NOON)).toBe("3:00 PM");
  });

  it("does not consider hours at or before now", () => {
    const precipitationProbability = hourlyTimes().map((_, h) => (h <= 12 ? 90 : 5));
    const weather = baseWeather({
      weatherCode: 1,
      hourly: {
        times: hourlyTimes(),
        precipitation: hourlyTimes().map(() => 0),
        precipitationProbability,
        uvIndex: hourlyTimes().map(() => 0),
      },
    });
    expect(rainLaterLabel(weather, NOON)).toBeNull();
  });

  it("returns null when nothing later today qualifies", () => {
    const weather = baseWeather({
      weatherCode: 1,
      hourly: {
        times: hourlyTimes(),
        precipitation: hourlyTimes().map(() => 0),
        precipitationProbability: hourlyTimes().map(() => 10),
        uvIndex: hourlyTimes().map(() => 0),
      },
    });
    expect(rainLaterLabel(weather, NOON)).toBeNull();
  });
});

describe("currentUvIndex (FLUX-256)", () => {
  it("reads the current-hour value from the hourly series", () => {
    const uvIndex = hourlyTimes().map((_, h) => (h === 12 ? 8 : 1));
    const weather = baseWeather({
      hourly: { times: hourlyTimes(), precipitation: hourlyTimes().map(() => 0), precipitationProbability: hourlyTimes().map(() => 0), uvIndex },
    });
    expect(currentUvIndex(weather, NOON)).toBe(8);
  });

  it("falls back to daily uvIndexMax when hourly is unavailable", () => {
    expect(currentUvIndex(baseWeather({ uvIndexMax: 7 }), NOON)).toBe(7);
  });

  it("returns null when neither hourly nor daily max is present", () => {
    expect(currentUvIndex(baseWeather(), NOON)).toBeNull();
  });
});

describe("isDryingDay (FLUX-256)", () => {
  const dryHourly = {
    times: hourlyTimes(),
    precipitation: hourlyTimes().map(() => 0),
    precipitationProbability: hourlyTimes().map(() => 0),
    uvIndex: hourlyTimes().map(() => 0),
  };

  it("passes when clear, dry, breezy, and no rain forecast", () => {
    const weather = baseWeather({ weatherCode: 1, humidity: 45, windSpeedKmh: 15, hourly: dryHourly });
    expect(isDryingDay(weather, NOON)).toBe(true);
  });

  it("fails when weather code is beyond the clear/partly-cloudy band", () => {
    const weather = baseWeather({ weatherCode: 45, humidity: 45, windSpeedKmh: 15, hourly: dryHourly });
    expect(isDryingDay(weather, NOON)).toBe(false);
  });

  it("fails when humidity is at or above the threshold", () => {
    const weather = baseWeather({ weatherCode: 1, humidity: 60, windSpeedKmh: 15, hourly: dryHourly });
    expect(isDryingDay(weather, NOON)).toBe(false);
  });

  it("fails when wind is outside the 5-25 km/h band", () => {
    const weather = baseWeather({ weatherCode: 1, humidity: 45, windSpeedKmh: 2, hourly: dryHourly });
    expect(isDryingDay(weather, NOON)).toBe(false);
  });

  it("fails when rain is forecast later today", () => {
    const rainy = { ...dryHourly, precipitation: hourlyTimes().map((_, h) => (h === 16 ? 1 : 0)) };
    const weather = baseWeather({ weatherCode: 1, humidity: 45, windSpeedKmh: 15, hourly: rainy });
    expect(isDryingDay(weather, NOON)).toBe(false);
  });
});

describe("sunsetInfo (FLUX-256)", () => {
  it("formats sunset and golden hour (37min before) as 12h local time", () => {
    const weather = baseWeather({ sunset: `${DATE}T19:42` });
    expect(sunsetInfo(weather)).toEqual({ sunset: "7:42 PM", goldenHour: "7:05 PM" });
  });

  it("returns null when sunset is unavailable", () => {
    expect(sunsetInfo(baseWeather())).toBeNull();
  });
});
