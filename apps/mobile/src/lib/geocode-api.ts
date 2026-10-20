// HOUP-149: native calls to GET /api/geocode (apps/web/src/app/api/geocode/
// route.ts — the Mapbox token stays server-side there) and to the existing
// token-free GET /api/nearby-pois. Same authedFetch pattern as
// apps/mobile/src/features/homesearch/parse-listing-api.ts: an
// absolute-origin fetch with the current Supabase session's access token
// attached as `Authorization: Bearer`. The nearest-POI haversine reduction
// mirrors apps/web/src/lib/nearest-pois-client.ts (that file lives in
// apps/web, so the pure calc is duplicated here rather than imported).
import type { NearbyPOI } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

async function authedFetch(path: string): Promise<Response | null> {
  const server = await getStoredServer();
  if (!server) return null;

  const supabase = getCurrentSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return fetch(`${server.origin}${path}`, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
}

/** Best-effort geocode via the server proxy. Returns null on any failure — callers already have the row saved locally. */
export async function geocodeAddress(address: string, suburb?: string | null): Promise<{ lat: number; lng: number } | null> {
  try {
    const params = new URLSearchParams({ address });
    if (suburb) params.set('suburb', suburb);
    const res = await authedFetch(`/api/geocode?${params}`);
    if (!res || !res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Best-effort nearest supermarket/transport distances via the existing token-free /api/nearby-pois route. */
export async function fetchNearestPoiDistances(
  lat: number,
  lng: number,
  radius = 1000
): Promise<{ nearest_supermarket_m: number | null; nearest_transport_m: number | null }> {
  const fallback = { nearest_supermarket_m: null, nearest_transport_m: null };
  try {
    const pad = radius / 111000;
    const params = new URLSearchParams({
      south: (lat - pad).toFixed(5),
      west: (lng - pad).toFixed(5),
      north: (lat + pad).toFixed(5),
      east: (lng + pad).toFixed(5),
    });
    const res = await authedFetch(`/api/nearby-pois?${params}`);
    if (!res || !res.ok) return fallback;

    const json = await res.json();
    const pois: NearbyPOI[] = json.pois ?? [];

    let nearestSuper = Infinity;
    let nearestTransport = Infinity;
    for (const poi of pois) {
      const dist = haversine(lat, lng, poi.lat, poi.lng);
      if (poi.category === 'supermarket') {
        nearestSuper = Math.min(nearestSuper, dist);
      } else {
        nearestTransport = Math.min(nearestTransport, dist);
      }
    }

    return {
      nearest_supermarket_m: nearestSuper === Infinity ? null : Math.round(nearestSuper),
      nearest_transport_m: nearestTransport === Infinity ? null : Math.round(nearestTransport),
    };
  } catch {
    return fallback;
  }
}
