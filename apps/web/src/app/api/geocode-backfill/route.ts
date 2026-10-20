import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geocode";

export async function POST() {
  const supabase = await createClient();

  const { data: apartments, error } = await supabase
    .from("apartments")
    .select("id, address, suburb")
    .is("lat", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let updated = 0;
  let failed = 0;

  for (const apt of apartments || []) {
    const coords = await geocodeAddress(apt.address, apt.suburb);
    if (coords) {
      await supabase
        .from("apartments")
        .update({ lat: coords.lat, lng: coords.lng })
        .eq("id", apt.id);
      updated++;
    } else {
      failed++;
    }
  }

  return NextResponse.json({ total: apartments?.length ?? 0, updated, failed });
}
