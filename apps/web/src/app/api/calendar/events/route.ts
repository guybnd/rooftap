import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";
import type { GoogleCalendarEventWithAttribution } from '@homeup/core';

// FLUX-157: overlay feed for the /calendar page + /home hub. Merges the
// caller's own staged events with OTHER group members' events they've shared
// (visibility='group'). Dismissed rows still render here (Decision 5) — only
// /api/calendar/suggestions filters state.

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const off = await requireModules(user.id, "google-calendar");
    if (off) return off;

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) {
      return NextResponse.json({ error: "Missing from/to" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: memberships } = await admin
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id);
    const groupIds = Array.from(new Set((memberships ?? []).map((m) => m.group_id)));

    let otherUserIds: string[] = [];
    if (groupIds.length > 0) {
      const { data: otherMembers } = await admin
        .from("group_members")
        .select("user_id")
        .in("group_id", groupIds)
        .neq("user_id", user.id);
      otherUserIds = Array.from(new Set((otherMembers ?? []).map((m) => m.user_id)));
    }

    // FLUX-233 #5/#6: pull_enabled gates the READ path too, not just calendar-sync's
    // write path — toggling it off must hide events immediately without deleting the
    // already-pulled rows (edge case in the ticket).
    const connectionUserIds = Array.from(new Set([user.id, ...otherUserIds]));
    const { data: connections } = await admin
      .from("google_calendar_connections")
      .select("user_id, pull_enabled")
      .in("user_id", connectionUserIds);
    const pullDisabledUserIds = new Set(
      (connections ?? []).filter((c) => c.pull_enabled === false).map((c) => c.user_id)
    );

    const pullEnabledForSelf = !pullDisabledUserIds.has(user.id);
    const sharedUserIds = otherUserIds.filter((id) => !pullDisabledUserIds.has(id));

    const ownQuery = pullEnabledForSelf
      ? admin
          .from("google_calendar_events")
          .select("*")
          .eq("user_id", user.id)
          .gte("starts_at", from)
          .lte("starts_at", to)
      : null;

    // Never queried unless sharedUserIds is non-empty — a private row of member A
    // structurally cannot reach this response for member B (Note 1).
    const sharedQuery =
      sharedUserIds.length > 0
        ? admin
            .from("google_calendar_events")
            .select("*")
            .in("user_id", sharedUserIds)
            .eq("visibility", "group")
            .gte("starts_at", from)
            .lte("starts_at", to)
        : null;

    const [ownResult, sharedResult] = await Promise.all([
      ownQuery ?? Promise.resolve({ data: [], error: null }),
      sharedQuery ?? Promise.resolve({ data: [], error: null }),
    ]);
    if (ownResult.error) throw ownResult.error;
    if (sharedResult.error) throw sharedResult.error;

    const own: GoogleCalendarEventWithAttribution[] = (ownResult.data ?? []) as GoogleCalendarEventWithAttribution[];
    const shared: GoogleCalendarEventWithAttribution[] = ((sharedResult.data ?? []) as GoogleCalendarEventWithAttribution[]).map(
      (row) => ({ ...row, sharedByUserId: row.user_id })
    );

    const events = [...own, ...shared].sort(
      (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );

    return NextResponse.json({ events });
  } catch (err) {
    console.error("calendar/events GET failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
