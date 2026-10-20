interface OverpassElement {
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
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

export async function fetchNearestPoiDistances(
  lat: number,
  lng: number,
  radius = 1000
): Promise<{ nearest_supermarket_m: number | null; nearest_transport_m: number | null }> {
  const query = `[out:json][timeout:15];(node["shop"="supermarket"](around:${radius},${lat},${lng});node["highway"="bus_stop"](around:${radius},${lat},${lng});node["railway"="tram_stop"](around:${radius},${lat},${lng});node["railway"="station"](around:${radius},${lat},${lng}););out body;`;

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!res.ok) return { nearest_supermarket_m: null, nearest_transport_m: null };

    const json = await res.json();
    const elements: OverpassElement[] = json.elements ?? [];

    let nearestSuper = Infinity;
    let nearestTransport = Infinity;

    for (const el of elements) {
      const dist = haversine(lat, lng, el.lat, el.lon);
      if (el.tags?.shop === "supermarket") {
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
