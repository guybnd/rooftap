import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Mapbox token not configured" }, { status: 500 });
  }

  const coordinates = request.nextUrl.searchParams.get("coordinates");
  const profile = request.nextUrl.searchParams.get("profile") || "walking";

  if (!coordinates) {
    return NextResponse.json({ error: "coordinates parameter required" }, { status: 400 });
  }

  if (profile !== "walking" && profile !== "driving" && profile !== "cycling") {
    return NextResponse.json({ error: "profile must be 'walking', 'driving', or 'cycling'" }, { status: 400 });
  }

  const points = coordinates.split(";");
  if (points.length < 2) {
    return NextResponse.json({ error: "At least 2 coordinate pairs required" }, { status: 400 });
  }

  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinates}?geometries=geojson&overview=full&steps=true&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Mapbox API error: ${text}` }, { status: res.status });
  }

  const data = await res.json();
  const route = data.routes?.[0];

  if (!route) {
    return NextResponse.json({ error: "No route found" }, { status: 404 });
  }

  const legs = route.legs.map((leg: { duration: number; distance: number; steps: { geometry: GeoJSON.LineString }[] }) => {
    const legCoords: [number, number][] = [];
    for (const step of leg.steps || []) {
      if (step.geometry?.coordinates) {
        for (const coord of step.geometry.coordinates as [number, number][]) {
          if (legCoords.length === 0 || coord[0] !== legCoords[legCoords.length - 1][0] || coord[1] !== legCoords[legCoords.length - 1][1]) {
            legCoords.push(coord);
          }
        }
      }
    }
    return {
      duration: leg.duration,
      distance: leg.distance,
      geometry: { type: "LineString" as const, coordinates: legCoords },
    };
  });

  return NextResponse.json({
    geometry: route.geometry,
    legs,
    totalDuration: route.duration,
    totalDistance: route.distance,
  });
}
