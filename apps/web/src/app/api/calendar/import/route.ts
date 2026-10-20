import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";
import type { GoogleCalendarEvent } from '@homeup/core';

// FLUX-157: convert a staged google_calendar_events row into a real
// appointment/task. Echo-control order matters: the google_calendar_pushed_events
// mapping row is inserted BEFORE the appointment/task row, so the calendar-push
// Edge Function (fired by the appointments/household_tasks AFTER INSERT trigger)
// sees the importer already has a mapping and skips re-pushing a duplicate
// Google event to them — it still fans out to every OTHER connected member.

// household_tasks.due_date/due_time are naive wall-clock values with no zone of
// their own (see supabase/migrations/20260617000002_add_household_task_due_time.sql).
// FLUX-228: resolved from the importing user's user_settings.timezone; this is
// only the fallback for a missing/null row. Kept in lockstep with the twin
// constant in supabase/functions/calendar-push/index.ts.
const DEFAULT_CALENDAR_TIMEZONE = "Australia/Sydney";

// Splits a staged google_calendar_events row into a wall-clock date + optional
// time, using the row's authoritative is_all_day flag (captured straight from
// Google's start.date vs start.dateTime at pull time) rather than re-deriving
// it from starts_at — a UTC-midnight heuristic misclassifies any timed event
// that happens to start at local midnight in the target timezone.
function splitStartsAt(
  startsAt: string,
  isAllDay: boolean,
  timezone: string,
): { due_date: string; due_time: string | null } {
  if (isAllDay) {
    // All-day events pull from Google as a date-only value with no time
    // component to lose — safe to slice directly with no zone conversion.
    return { due_date: startsAt.slice(0, 10), due_time: null };
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(startsAt));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    due_date: `${get("year")}-${get("month")}-${get("day")}`,
    due_time: `${get("hour")}:${get("minute")}`,
  };
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const off = await requireModules(user.id, "google-calendar");
    if (off) return off;

    const body = await request.json().catch(() => null);
    const eventId: string | undefined = body?.eventId;
    const target: "appointment" | "task" | undefined = body?.target;
    const apartmentId: string | undefined = body?.apartmentId;
    if (!eventId || (target !== "appointment" && target !== "task")) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    // A viewing lands in Home Search and a to-do in Tasks: neither is created
    // in a switched-off module (module-features.ts, calendar.viewings / calendar.tasks).
    const targetOff = await requireModules(user.id, target === "appointment" ? "search" : "household");
    if (targetOff) return targetOff;

    const admin = createAdminClient();

    const { data: event, error: eventError } = await admin
      .from("google_calendar_events")
      .select("*")
      .eq("id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const row = event as GoogleCalendarEvent;
    if (row.state === "imported") {
      return NextResponse.json({ error: "already_imported" }, { status: 400 });
    }

    const newId = crypto.randomUUID();

    if (target === "appointment") {
      if (!apartmentId) {
        return NextResponse.json({ error: "Missing apartmentId" }, { status: 400 });
      }

      const { data: apartment, error: apartmentError } = await admin
        .from("apartments")
        .select("group_id")
        .eq("id", apartmentId)
        .maybeSingle();
      if (apartmentError) throw apartmentError;
      if (!apartment) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const { data: membership, error: membershipError } = await admin
        .from("group_members")
        .select("group_id")
        .eq("group_id", apartment.group_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

      const { error: pushedError } = await admin.from("google_calendar_pushed_events").insert({
        user_id: user.id,
        entity_type: "appointment",
        entity_id: newId,
        gcal_event_id: row.gcal_event_id,
        synced_at: new Date().toISOString(),
        // Adopts the importer's OWN pre-existing Google event purely to
        // suppress a duplicate push back to themselves (Decision 6 echo
        // control) — origin:'import' tells calendar-push/calendar-sync/the
        // disconnect route to never write to or delete this event.
        origin: "import",
      });
      if (pushedError) throw pushedError;

      const { error: appointmentError2 } = await admin.from("appointments").insert({
        id: newId,
        user_id: user.id,
        group_id: apartment.group_id,
        apartment_id: apartmentId,
        scheduled_at: row.starts_at,
        notes: row.description,
      });
      if (appointmentError2) throw appointmentError2;

      const { error: updateError } = await admin
        .from("google_calendar_events")
        .update({ state: "imported", imported_appointment_id: newId })
        .eq("id", eventId);
      if (updateError) throw updateError;
    } else {
      const { data: membership, error: membershipError } = await admin
        .from("group_members")
        .select("group_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return NextResponse.json({ error: "No group" }, { status: 400 });

      const { data: settings, error: settingsError } = await admin
        .from("user_settings")
        .select("timezone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (settingsError) throw settingsError;
      const timezone = settings?.timezone ?? DEFAULT_CALENDAR_TIMEZONE;

      const { due_date, due_time } = splitStartsAt(row.starts_at, row.is_all_day, timezone);

      const { error: pushedError } = await admin.from("google_calendar_pushed_events").insert({
        user_id: user.id,
        entity_type: "task",
        entity_id: newId,
        gcal_event_id: row.gcal_event_id,
        synced_at: new Date().toISOString(),
        // See the appointment branch above — echo-control adoption of the
        // importer's own pre-existing Google event, never Rooftap-owned.
        origin: "import",
      });
      if (pushedError) throw pushedError;

      const { error: taskError } = await admin.from("household_tasks").insert({
        id: newId,
        group_id: membership.group_id,
        title: row.title ?? "Imported event",
        due_date,
        due_time,
        done: false,
        assigned_to: user.id,
        private: false,
        notes: row.description,
        deleted: false,
        sort_order: 0,
      });
      if (taskError) throw taskError;

      const { error: updateError } = await admin
        .from("google_calendar_events")
        .update({ state: "imported", imported_task_id: newId })
        .eq("id", eventId);
      if (updateError) throw updateError;
    }

    return NextResponse.json({ ok: true, createdId: newId });
  } catch (err) {
    console.error("calendar/import POST failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
