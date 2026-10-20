import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";

// GET /api/calendar/status
// Response: { connected: boolean, settings: null | { selected_calendar_ids, suggest_mode,
//   dedicated_calendar_id, keywords, pull_window_past_days, pull_window_future_days,
//   default_import_visibility, pull_enabled, push_todos_enabled } }
// Never leaks access_token/refresh_token to the client.
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const off = await requireModules(user.id, "google-calendar");
    if (off) return off;

    const admin = createAdminClient();
    const { data: connection, error } = await admin
      .from("google_calendar_connections")
      .select(
        "selected_calendar_ids, suggest_mode, dedicated_calendar_id, keywords, pull_window_past_days, pull_window_future_days, default_import_visibility, pull_enabled, push_todos_enabled"
      )
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      connected: !!connection,
      settings: connection ?? null,
    });
  } catch (err) {
    console.error("calendar/status GET failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
