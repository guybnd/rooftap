import { distanceMetres, type SourceStore } from "@homeup/core";
import type { ShopperSource } from "./types";

// Store branches near the household from OpenStreetMap, through the public
// Overpass API (the same service /api/nearby-pois uses). No key, any region.
// Matches on the shop's name or brand tag, so "JB Hi-Fi" finds every JB Hi-Fi
// branch within the search radius.

const RADIUS_M = 25_000;
const ENDPOINT = "https://overpass-api.de/api/interpreter";

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|"]/g, "\\$&");
}

export const osmStores: ShopperSource = {
  manifest: {
    id: "osm-stores",
    name: "OpenStreetMap",
    regions: "*",
    capabilities: ["stores"],
    kind: "api",
    env: [],
    attribution: "Store locations © OpenStreetMap contributors",
    homepage: "https://www.openstreetmap.org/copyright",
    ratePerMinute: 10,
  },

  async nearbyStores(storeName, ctx) {
    if (!ctx.near) return [];
    const name = escapeRegex(storeName.trim());
    if (!name) return [];
    const { lat, lng } = ctx.near;
    const around = `around:${RADIUS_M},${lat},${lng}`;
    const query = `[out:json][timeout:15];(nwr["shop"]["name"~"^${name}$",i](${around});nwr["shop"]["brand"~"^${name}$",i](${around}););out center 20;`;
    const res = await ctx.fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
    const body = (await res.json()) as { elements?: OverpassElement[] };
    const stores: SourceStore[] = [];
    for (const el of body.elements ?? []) {
      const pLat = el.lat ?? el.center?.lat;
      const pLng = el.lon ?? el.center?.lon;
      if (pLat == null || pLng == null) continue;
      const t = el.tags ?? {};
      const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
      stores.push({
        name: t.name ?? storeName,
        lat: pLat,
        lng: pLng,
        address: [street, t["addr:suburb"] ?? t["addr:city"]].filter(Boolean).join(", ") || null,
        hours: t.opening_hours ?? null,
      });
    }
    return stores.sort((a, b) => distanceMetres(ctx.near!, a) - distanceMetres(ctx.near!, b));
  },
};
