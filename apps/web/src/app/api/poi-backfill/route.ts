import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const off = await requireModules(user.id, "search");
  if (off) return off;
  const supabase = await createClient();
  const body = await request.json();
  const updates: { id: string; nearest_supermarket_m: number | null; nearest_transport_m: number | null }[] = body.updates;

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: "updates array required" }, { status: 400 });
  }

  let updated = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("apartments")
      .update({
        nearest_supermarket_m: u.nearest_supermarket_m,
        nearest_transport_m: u.nearest_transport_m,
      })
      .eq("id", u.id);
    if (!error) updated++;
  }

  return NextResponse.json({ updated, total: updates.length });
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const off = await requireModules(user.id, "search");
  if (off) return off;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("apartments")
    .select("id, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .is("nearest_supermarket_m", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ apartments: data });
}
