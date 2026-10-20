import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";
import { getFreshAccessToken, listCalendars } from "@/lib/google-calendar";
import type { GoogleCalendarConnection } from '@homeup/core';

// GET /api/calendar/calendars
// Response (200): { calendars: { id, summary, primary? }[] }
// Response (404): { error: "not_connected" } — no google_calendar_connections row for this user.
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const off = await requireModules(user.id, "google-calendar");
    if (off) return off;

    const admin = createAdminClient();
    const { data: connection, error } = await admin
      .from("google_calendar_connections")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });

    const accessToken = await getFreshAccessToken(connection as GoogleCalendarConnection);
    const calendars = await listCalendars(accessToken);

    return NextResponse.json({ calendars });
  } catch (err) {
    console.error("calendar/calendars GET failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// PUT /api/calendar/calendars
// Body: { selected_calendar_ids?: string[], suggest_mode?: string, dedicated_calendar_id?: string|null,
//   keywords?: string[], pull_window_past_days?: number, pull_window_future_days?: number,
//   default_import_visibility?: 'private'|'group', pull_enabled?: boolean, push_todos_enabled?: boolean }
// Response: { ok: true }
export async function PUT(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const off = await requireModules(user.id, "google-calendar");
    if (off) return off;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (Array.isArray(body.selected_calendar_ids)) update.selected_calendar_ids = body.selected_calendar_ids;
    if (typeof body.suggest_mode === "string") update.suggest_mode = body.suggest_mode;
    if (body.dedicated_calendar_id === null || typeof body.dedicated_calendar_id === "string") {
      update.dedicated_calendar_id = body.dedicated_calendar_id;
    }
    if (Array.isArray(body.keywords)) update.keywords = body.keywords;
    if (typeof body.pull_window_past_days === "number") update.pull_window_past_days = body.pull_window_past_days;
    if (typeof body.pull_window_future_days === "number") update.pull_window_future_days = body.pull_window_future_days;
    if (body.default_import_visibility === "private" || body.default_import_visibility === "group") {
      update.default_import_visibility = body.default_import_visibility;
    }
    if (typeof body.pull_enabled === "boolean") update.pull_enabled = body.pull_enabled;
    if (typeof body.push_todos_enabled === "boolean") update.push_todos_enabled = body.push_todos_enabled;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No valid fields" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("google_calendar_connections")
      .update(update)
      .eq("user_id", user.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("calendar/calendars PUT failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
