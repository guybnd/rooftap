import { NextRequest, NextResponse } from "next/server";

interface WeatherPayload {
  tempC: number;
  weatherCode: number;
  highC: number;
  lowC: number;
  humidity?: number;
  windSpeedKmh?: number;
  sunset?: string;
  uvIndexMax?: number;
  hourly?: {
    times: string[];
    precipitation: number[];
    precipitationProbability: number[];
    uvIndex: number[];
  };
  ahead?: {
    times: string[];
    tempC: number[];
    precipitationProbability: number[];
  };
}

/** Hourly entries Home's day ribbon shows, starting at the current hour. */
const AHEAD_HOURS = 12;
/** Open-Meteo hourly series run from local midnight, so today is the first 24 entries. */
const HOURS_PER_DAY = 24;

const CACHE_TTL_MS = 45 * 60 * 1000;
const CACHE_MAX_SIZE = 100;
const UPSTREAM_TIMEOUT_MS = 5000;
const cache = new Map<string, { data: WeatherPayload; expiresAt: number }>();

function setCacheEntry(key: string, data: WeatherPayload): void {
  if (cache.size >= CACHE_MAX_SIZE) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k);
    }
    while (cache.size >= CACHE_MAX_SIZE) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  }
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function GET(request: NextRequest) {
  const latParam = request.nextUrl.searchParams.get("lat");
  const lngParam = request.nextUrl.searchParams.get("lng");

  if (!latParam || !lngParam) {
    return NextResponse.json({ error: "lat and lng parameters required" }, { status: 400 });
  }

  const lat = Number(latParam);
  const lng = Number(lngParam);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng must be numbers" }, { status: 400 });
  }

  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&hourly=temperature_2m,precipitation,precipitation_probability,uv_index&daily=temperature_2m_max,temperature_2m_min,sunset,uv_index_max&timezone=auto&forecast_days=2`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Open-Meteo request timed out" }, { status: 504 });
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Open-Meteo API error: ${text}` }, { status: res.status });
  }

  const raw = await res.json();
  const tempC = raw.current?.temperature_2m;
  const weatherCode = raw.current?.weather_code;
  const highC = raw.daily?.temperature_2m_max?.[0];
  const lowC = raw.daily?.temperature_2m_min?.[0];

  if (typeof tempC !== "number" || typeof weatherCode !== "number" || typeof highC !== "number" || typeof lowC !== "number") {
    return NextResponse.json({ error: "Incomplete weather data" }, { status: 502 });
  }

  const data: WeatherPayload = { tempC, weatherCode, highC, lowC };

  const humidity = raw.current?.relative_humidity_2m;
  if (typeof humidity === "number") data.humidity = humidity;

  const windSpeedKmh = raw.current?.wind_speed_10m;
  if (typeof windSpeedKmh === "number") data.windSpeedKmh = windSpeedKmh;

  const sunset = raw.daily?.sunset?.[0];
  if (typeof sunset === "string") data.sunset = sunset;

  const uvIndexMax = raw.daily?.uv_index_max?.[0];
  if (typeof uvIndexMax === "number") data.uvIndexMax = uvIndexMax;

  const times = raw.hourly?.time;
  const precipitation = raw.hourly?.precipitation;
  const precipitationProbability = raw.hourly?.precipitation_probability;
  const uvIndex = raw.hourly?.uv_index;
  if (Array.isArray(times) && Array.isArray(precipitation) && Array.isArray(precipitationProbability) && Array.isArray(uvIndex)) {
    // `hourly` stays today-only (the tip helpers scan it to the end of the day);
    // two forecast days are fetched so `ahead` can run past midnight.
    data.hourly = {
      times: times.slice(0, HOURS_PER_DAY),
      precipitation: precipitation.slice(0, HOURS_PER_DAY),
      precipitationProbability: precipitationProbability.slice(0, HOURS_PER_DAY),
      uvIndex: uvIndex.slice(0, HOURS_PER_DAY),
    };

    const temperature = raw.hourly?.temperature_2m;
    const currentTime = raw.current?.time;
    if (Array.isArray(temperature) && typeof currentTime === "string") {
      // `current.time` is local like the hourly times ("2026-10-19T13:15").
      const start = times.findIndex((t: unknown) => typeof t === "string" && t.slice(0, 13) === currentTime.slice(0, 13));
      if (start >= 0) {
        const end = start + AHEAD_HOURS;
        data.ahead = {
          times: times.slice(start, end),
          tempC: temperature.slice(start, end),
          precipitationProbability: precipitationProbability.slice(start, end),
        };
      }
    }
  }

  setCacheEntry(cacheKey, data);

  return NextResponse.json(data);
}
