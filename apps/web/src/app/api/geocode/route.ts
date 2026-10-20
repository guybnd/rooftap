import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/session";
import { geocodeAddress } from "@/lib/geocode";

// HOUP-149: native has no Mapbox token in its bundle (by design — see
// apps/mobile/src/features/homesearch/create-apartment-from-parsed.ts), so
// it geocodes through this authed proxy instead of calling Mapbox directly.
// Auth goes through the shared, Bearer-capable getSessionUser (same as
// push/device-token/route.ts) — NOT the cookie-only createServerSupabase()
// gate geocode-backfill/route.ts uses, which would 401 every native call.
// The Mapbox token (NEXT_PUBLIC_MAPBOX_TOKEN) only ever reads server-side
// here; it is never returned to the client.
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const address = searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }
  const suburb = searchParams.get("suburb");

  const coords = await geocodeAddress(address, suburb);
  if (!coords) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(coords);
}
