import { describe, expect, it } from "vitest";
import {
  conditionForWeatherCode,
  currentUvIndex,
  isDryingDay,
  rainLaterLabel,
  sunsetInfo,
  weatherRecommendation,
  type WeatherData,
} from "./weather-tips";

const NOON = new Date(2026, 6, 31, 12, 0, 0);

function weather(overrides: Partial<WeatherData> = {}): WeatherData {
  return {
    tempC: 20,
    weatherCode: 1,
    highC: 24,
    lowC: 14,
    ...overrides,
  };
}

describe("conditionForWeatherCode", () => {
  it("collapses WMO codes into a small condition set", () => {
    expect(conditionForWeatherCode(0).condition).toBe("clear");
    expect(conditionForWeatherCode(2).condition).toBe("partly-cloudy");
    expect(conditionForWeatherCode(61).condition).toBe("rain");
    expect(conditionForWeatherCode(75).condition).toBe("snow");
    expect(conditionForWeatherCode(95).condition).toBe("thunderstorm");
  });

  it("maps WMO code 3 to overcast, distinct from partly cloudy", () => {
    expect(conditionForWeatherCode(3)).toEqual({ condition: "cloudy", label: "Overcast" });
    expect(conditionForWeatherCode(2)).toEqual({ condition: "partly-cloudy", label: "Partly cloudy" });
  });
});

describe("weatherRecommendation", () => {
  it("flags rain codes over everything else", () => {
    expect(weatherRecommendation({ weatherCode: 61, tempC: 20, rainLaterLabel: null })?.kind).toBe("rain");
  });
  it("flags snow codes", () => {
    expect(weatherRecommendation({ weatherCode: 71, tempC: 20, rainLaterLabel: null })?.kind).toBe("snow");
  });
  it("surfaces a rain-later heads-up when clear now", () => {
    const rec = weatherRecommendation({ weatherCode: 1, tempC: 20, rainLaterLabel: "3:00 PM" });
    expect(rec?.kind).toBe("rain");
    expect(rec?.text).toContain("3:00 PM");
  });
  it("flags hot/cold temps when no precipitation signal applies", () => {
    expect(weatherRecommendation({ weatherCode: 1, tempC: 30, rainLaterLabel: null })?.kind).toBe("hot");
    expect(weatherRecommendation({ weatherCode: 1, tempC: 2, rainLaterLabel: null })?.kind).toBe("cold");
  });
  it("returns null for a mild, dry, clear day", () => {
    expect(weatherRecommendation({ weatherCode: 1, tempC: 20, rainLaterLabel: null })).toBeNull();
  });
});

describe("rainLaterLabel", () => {
  it("returns null when it's already raining", () => {
    expect(rainLaterLabel(weather({ weatherCode: 61 }), NOON)).toBeNull();
  });
  it("returns null with no hourly series", () => {
    expect(rainLaterLabel(weather(), NOON)).toBeNull();
  });
  it("finds the next qualifying hour by probability", () => {
    const times = Array.from({ length: 24 }, (_, h) => `2026-07-31T${String(h).padStart(2, "0")}:00`);
    const w = weather({
      weatherCode: 1,
      hourly: {
        times,
        precipitation: times.map(() => 0),
        precipitationProbability: times.map((_, h) => (h === 15 ? 80 : 0)),
        uvIndex: times.map(() => 0),
      },
    });
    expect(rainLaterLabel(w, NOON)).toBe("3:00 PM");
  });
});

describe("currentUvIndex", () => {
  it("falls back to the daily max with no hourly series", () => {
    expect(currentUvIndex(weather({ uvIndexMax: 7 }), NOON)).toBe(7);
  });
  it("prefers the current-hour hourly value", () => {
    const times = Array.from({ length: 24 }, (_, h) => `2026-07-31T${String(h).padStart(2, "0")}:00`);
    const w = weather({
      uvIndexMax: 3,
      hourly: { times, precipitation: times.map(() => 0), precipitationProbability: times.map(() => 0), uvIndex: times.map((_, h) => (h === 12 ? 9 : 1)) },
    });
    expect(currentUvIndex(w, NOON)).toBe(9);
  });
});

describe("isDryingDay", () => {
  it("requires clear-ish + dry + breezy + no forecast rain", () => {
    expect(isDryingDay(weather({ weatherCode: 1, humidity: 40, windSpeedKmh: 15 }), NOON)).toBe(true);
  });
  it("rejects overcast beyond the drying threshold", () => {
    expect(isDryingDay(weather({ weatherCode: 60, humidity: 40, windSpeedKmh: 15 }), NOON)).toBe(false);
  });
  it("rejects high humidity", () => {
    expect(isDryingDay(weather({ weatherCode: 1, humidity: 80, windSpeedKmh: 15 }), NOON)).toBe(false);
  });
});

describe("sunsetInfo", () => {
  it("returns null with no sunset field", () => {
    expect(sunsetInfo(weather())).toBeNull();
  });
  it("computes a fixed golden-hour offset before sunset", () => {
    const info = sunsetInfo(weather({ sunset: "2026-07-31T19:42" }));
    expect(info?.sunset).toBe("7:42 PM");
    expect(info?.goldenHour).toBe("7:05 PM");
  });
});
