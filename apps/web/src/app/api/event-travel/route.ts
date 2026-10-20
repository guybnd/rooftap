import { NextRequest, NextResponse } from "next/server";
import { MAPBOX_PROFILE, isTravelMode } from "@homeup/core";
import { geocodeAddress } from "@/lib/geocode";
import { getSessionUser } from "@/lib/supabase/session";

// Calendar "time to leave": travel minutes from the household's home
// (`from_lat`/`from_lng`) to an event's free-text `place`, by `mode`
// (drive | walk | cycle). Geocoding and directions both use Mapbox, so the
// token stays here. Answers { minutes: number | null }. The agenda's travel
// between two events passes the first one's place as `from` instead of the
// home's coordinates (core event-legs.ts).

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_SIZE = 300;
const cache = new Map<string, { minutes: number | null; expiresAt: number }>();

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const place = params.get("place")?.trim().slice(0, 300);
  const mode = params.get("mode");
  const fromPlace = params.get("from")?.trim().slice(0, 300);
  const fromLat = Number(params.get("from_lat"));
  const fromLng = Number(params.get("from_lng"));
  const hasCoords = !!params.get("from_lat") && Number.isFinite(fromLat) && Number.isFinite(fromLng);
  if (!place || !isTravelMode(mode) || (!hasCoords && !fromPlace)) {
    return NextResponse.json({ error: "place, mode and from_lat/from_lng or from are required" }, { status: 400 });
  }
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return NextResponse.json({ minutes: null });

  const origin = hasCoords ? `${fromLat.toFixed(3)},${fromLng.toFixed(3)}` : fromPlace!.toLowerCase();
  const key = `${place.toLowerCase()}|${mode}|${origin}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return NextResponse.json({ minutes: hit.minutes });

  let minutes: number | null = null;
  try {
    const [from, to] = await Promise.all([
      hasCoords ? Promise.resolve({ lat: fromLat, lng: fromLng }) : geocodeAddress(fromPlace!),
      geocodeAddress(place),
    ]);
    if (from && to) {
      const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
      const res = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/${MAPBOX_PROFILE[mode]}/${coords}?overview=false&access_token=${token}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const duration = (await res.json())?.routes?.[0]?.duration;
        if (typeof duration === "number" && duration > 0) minutes = Math.max(1, Math.round(duration / 60));
      }
    }
  } catch {
    // Unknown travel time; the form says so and no push is set up.
  }
  if (cache.size >= CACHE_MAX_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { minutes, expiresAt: Date.now() + CACHE_TTL_MS });
  return NextResponse.json({ minutes });
}
