import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";
import { deleteEvent, getFreshAccessToken, revokeToken } from "@/lib/google-calendar";
import type { GoogleCalendarConnection, GoogleCalendarPushedEvent } from '@homeup/core';

// DELETE /api/calendar/connection — disconnect Google Calendar (Decision 9d order):
//   (a) best-effort delete every pushed Rooftap-originated event from Google
//   (b) revoke the stored refresh token
//   (c) delete this user's pushed_events, staged events, and the connection row
// Imported entities (appointments/household_tasks already created) and other
// members' connections/events are never touched.
// Response: { ok: true }
export async function DELETE() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const off = await requireModules(user.id, "google-calendar");
    if (off) return off;

    const admin = createAdminClient();
    const { data: connection, error: connectionError } = await admin
      .from("google_calendar_connections")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) return NextResponse.json({ ok: true });

    const typedConnection = connection as GoogleCalendarConnection;

    const { data: pushedEvents, error: pushedError } = await admin
      .from("google_calendar_pushed_events")
      .select("*")
      .eq("user_id", user.id);
    if (pushedError) throw pushedError;

    try {
      const accessToken = await getFreshAccessToken(typedConnection);
      for (const pushed of (pushedEvents ?? []) as GoogleCalendarPushedEvent[]) {
        // origin:'import' mappings alias the user's OWN pre-existing Google
        // event (Decision 6 echo control) — never delete it on disconnect,
        // only the mapping row itself (cleared below).
        if (pushed.origin === "import") continue;
        try {
          // Pushed events target the connection's dedicated "Rooftap" calendar
          // once one exists; connections that never pushed (no calendar
          // created yet) fall back to primary, matching the old behavior —
          // best-effort, 404s are fine.
          await deleteEvent(accessToken, typedConnection.homeup_calendar_id ?? "primary", pushed.gcal_event_id);
        } catch (err) {
          console.error("calendar/connection DELETE: failed to delete pushed event", pushed.gcal_event_id, err);
        }
      }
    } catch (err) {
      console.error("calendar/connection DELETE: failed to get fresh access token, skipping event cleanup", err);
    }

    try {
      await revokeToken(typedConnection.refresh_token);
    } catch (err) {
      console.error("calendar/connection DELETE: failed to revoke token", err);
    }

    const { error: deletePushedError } = await admin
      .from("google_calendar_pushed_events")
      .delete()
      .eq("user_id", user.id);
    if (deletePushedError) throw deletePushedError;

    const { error: deleteEventsError } = await admin
      .from("google_calendar_events")
      .delete()
      .eq("user_id", user.id);
    if (deleteEventsError) throw deleteEventsError;

    const { error: deleteConnectionError } = await admin
      .from("google_calendar_connections")
      .delete()
      .eq("user_id", user.id);
    if (deleteConnectionError) throw deleteConnectionError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("calendar/connection DELETE failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
