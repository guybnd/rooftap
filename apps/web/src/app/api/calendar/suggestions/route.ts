import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";
import type { GoogleCalendarEvent } from '@homeup/core';

// FLUX-157: classifier-flagged, viewing-looking events awaiting the user's
// import/dismiss decision. Own rows only — suggestions are never shared.

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const off = await requireModules(user.id, "google-calendar");
    if (off) return off;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("google_calendar_events")
      .select("*")
      .eq("user_id", user.id)
      .eq("state", "suggested")
      .order("starts_at", { ascending: true });
    if (error) throw error;

    return NextResponse.json({ suggestions: (data ?? []) as GoogleCalendarEvent[] });
  } catch (err) {
    console.error("calendar/suggestions GET failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
