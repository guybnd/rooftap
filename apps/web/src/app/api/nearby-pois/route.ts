import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/session";
import type { NearbyPOI } from '@homeup/core';

const cache = new Map<string, { pois: NearbyPOI[]; expires: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

interface OverpassElement {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

function categorize(tags?: Record<string, string>): NearbyPOI["category"] {
  if (tags?.shop === "supermarket") return "supermarket";
  if (tags?.railway === "station") return "train_station";
  if (tags?.railway === "tram_stop") return "tram_stop";
  return "bus_stop";
}

function buildBBoxQuery(south: number, west: number, north: number, east: number): string {
  return `[out:json][timeout:20];(node["shop"="supermarket"](${south},${west},${north},${east});node["highway"="bus_stop"](${south},${west},${north},${east});node["railway"="tram_stop"](${south},${west},${north},${east});node["railway"="station"](${south},${west},${north},${east}););out body;`;
}

function parseElements(elements: OverpassElement[], south: number, west: number, north: number, east: number): NearbyPOI[] {
  const seen = new Set<number>();
  const pois: NearbyPOI[] = [];
  const centerLat = (south + north) / 2;
  const centerLng = (west + east) / 2;
  for (const el of elements) {
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    const dLat = ((el.lat - centerLat) * Math.PI) / 180;
    const dLng = ((el.lon - centerLng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((centerLat * Math.PI) / 180) *
        Math.cos((el.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    pois.push({
      id: String(el.id),
      category: categorize(el.tags),
      name: el.tags?.name ?? null,
      lat: el.lat,
      lng: el.lon,
      distance: Math.round(distance),
    });
  }
  return pois;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

async function queryOverpass(query: string): Promise<OverpassElement[]> {
  const body = `data=${encodeURIComponent(query)}`;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Rooftap/1.0 (apartment search tool)",
        },
        body,
      });
      if (res.ok) {
        const json = await res.json();
        return json.elements ?? [];
      }
    } catch {
      continue;
    }
  }
  throw new Error("All Overpass endpoints failed");
}

export async function GET(request: NextRequest) {
  // Signed-in people only: the middleware lets any request with a Bearer
  // header through to /api, so the route checks the token itself.
  if (!(await getSessionUser())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = request.nextUrl;
  const south = parseFloat(searchParams.get("south") ?? "");
  const west = parseFloat(searchParams.get("west") ?? "");
  const north = parseFloat(searchParams.get("north") ?? "");
  const east = parseFloat(searchParams.get("east") ?? "");

  if ([south, west, north, east].some(isNaN)) {
    return NextResponse.json(
      { error: "south, west, north, east query parameters are required" },
      { status: 400 }
    );
  }

  if (north - south > 0.2 || east - west > 0.2) {
    return NextResponse.json(
      { error: "Bounding box too large (max ~20km)" },
      { status: 400 }
    );
  }

  const cacheKey = `${south.toFixed(3)},${west.toFixed(3)},${north.toFixed(3)},${east.toFixed(3)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json({ pois: cached.pois });
  }

  try {
    const query = buildBBoxQuery(south, west, north, east);
    const elements = await queryOverpass(query);
    const pois = parseElements(elements, south, west, north, east);

    cache.set(cacheKey, { pois, expires: Date.now() + CACHE_TTL_MS });
    return NextResponse.json({ pois });
  } catch (err) {
    console.error("Overpass proxy error:", err);
    return NextResponse.json(
      { error: "Failed to fetch POI data" },
      { status: 502 }
    );
  }
}
