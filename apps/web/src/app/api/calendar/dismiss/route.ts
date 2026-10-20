import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";

// FLUX-157: clear a suggestion without importing it. The row stays in the
// overlay (state='dismissed') — only a real 'suggested' row can be dismissed.

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
    const { data, error } = await admin
      .from("google_calendar_events")
      .update({ state: "dismissed" })
      .eq("id", eventId)
      .eq("user_id", user.id)
      .eq("state", "suggested")
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "not_a_suggestion" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("calendar/dismiss POST failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
