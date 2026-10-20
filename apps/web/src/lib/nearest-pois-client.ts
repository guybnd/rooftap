import type { NearbyPOI } from '@homeup/core';

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

export async function fetchNearestPoiDistancesClient(
  lat: number,
  lng: number,
  radius = 1000
): Promise<{ nearest_supermarket_m: number | null; nearest_transport_m: number | null }> {
  const pad = radius / 111000;
  const params = new URLSearchParams({
    south: (lat - pad).toFixed(5),
    west: (lng - pad).toFixed(5),
    north: (lat + pad).toFixed(5),
    east: (lng + pad).toFixed(5),
  });

  try {
    const res = await fetch(`/api/nearby-pois?${params}`);
    if (!res.ok) return { nearest_supermarket_m: null, nearest_transport_m: null };

    const json = await res.json();
    const pois: NearbyPOI[] = json.pois ?? [];

    let nearestSuper = Infinity;
    let nearestTransport = Infinity;

    for (const poi of pois) {
      const dist = haversine(lat, lng, poi.lat, poi.lng);
      if (poi.category === "supermarket") {
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
    return { nearest_supermarket_m: null, nearest_transport_m: null };
  }
}
