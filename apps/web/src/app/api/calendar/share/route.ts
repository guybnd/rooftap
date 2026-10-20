import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";

// FLUX-157: ad-hoc "share to group" (Decision 7) — a visibility elevation
// only, never a push or an entity.

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const off = await requireModules(user.id, "google-calendar");
    if (off) return off;

    const body = await request.json().catch(() => null);
    const eventId: string | undefined = body?.eventId;
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const admin = createAdminClient();
    // Own events only — a missing/foreign row returns 404 without revealing
    // whether it exists under another user.
    const { data, error } = await admin
      .from("google_calendar_events")
      .update({ visibility: "group" })
      .eq("id", eventId)
      .eq("user_id", user.id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("calendar/share POST failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
