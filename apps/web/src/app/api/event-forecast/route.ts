import { NextRequest, NextResponse } from "next/server";
import { openMeteoEventForecastUrl, pickEventForecast } from "@homeup/core";
import { geocodeAddress } from "@/lib/geocode";
import { getSessionUser } from "@/lib/supabase/session";

// Calendar: the forecast for one event. `place` is the event's free-text
// location, geocoded here (the Mapbox token stays server-side); `lat`/`lng`
// (the household's home) stand in when there's no place or it can't be found.
// `date` is the event's local day, `hour` its local start hour (omit for all
// day). Answers { forecast: EventForecast | null }.

const CACHE_TTL_MS = 45 * 60 * 1000;
const CACHE_MAX_SIZE = 300;
const forecasts = new Map<string, { data: unknown; expiresAt: number }>();
const places = new Map<string, { lat: number; lng: number } | null>();

function remember<V>(map: Map<string, V>, key: string, value: V) {
  if (map.size >= CACHE_MAX_SIZE) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

async function placeCoords(place: string): Promise<{ lat: number; lng: number } | null> {
  const key = place.trim().toLowerCase();
  if (places.has(key)) return places.get(key) ?? null;
  const coords = await geocodeAddress(place.trim()).catch(() => null);
  remember(places, key, coords);
  return coords;
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 });
  }
  const hourParam = params.get("hour");
  const hour = hourParam === null ? null : Number(hourParam);
  if (hour !== null && !(Number.isInteger(hour) && hour >= 0 && hour <= 23)) {
    return NextResponse.json({ error: "hour must be 0 to 23" }, { status: 400 });
  }

  const place = params.get("place")?.slice(0, 300);
  let coords = place?.trim() ? await placeCoords(place) : null;
  if (!coords) {
    const lat = Number(params.get("lat"));
    const lng = Number(params.get("lng"));
    if (params.get("lat") && params.get("lng") && Number.isFinite(lat) && Number.isFinite(lng)) coords = { lat, lng };
  }
  if (!coords) return NextResponse.json({ forecast: null });

  const key = `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)},${date}`;
  let raw = forecasts.get(key);
  if (!raw || raw.expiresAt <= Date.now()) {
    try {
      const res = await fetch(openMeteoEventForecastUrl(coords.lat, coords.lng, date), { signal: AbortSignal.timeout(5000) });
      // Out of the forecast range Open-Meteo answers 400; that's "no forecast yet", not an error.
      if (!res.ok) return NextResponse.json({ forecast: null });
      raw = { data: await res.json(), expiresAt: Date.now() + CACHE_TTL_MS };
      remember(forecasts, key, raw);
    } catch {
      return NextResponse.json({ forecast: null });
    }
  }
  return NextResponse.json({ forecast: pickEventForecast(raw.data, hour) });
}
