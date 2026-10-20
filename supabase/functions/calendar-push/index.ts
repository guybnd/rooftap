// FLUX-157: fans a household_tasks/appointments write out to every connected
// group member's Google Calendar. Invoked by the trg_calendar_push_task /
// trg_calendar_push_appointment DB triggers (see migration
// 20260713000001_create_google_calendar_tables.sql) via notify_edge_function(),
// exactly the same way notify-due-tasks is invoked by pg_cron.
//
// The per-member push/remove helpers below are also imported by calendar-sync
// (../calendar-sync/index.ts) to re-run the identical logic during periodic
// reconciliation (re-push stale, back-fill new connections, delete orphans) —
// keep the two in lockstep rather than forking the fan-out logic.
import { createAdmin, requireServiceRole } from "../_shared/send-push.ts";
import { createModuleLookup, isGoogleCalendarPushEnabled, type ModuleLookup } from "../_shared/modules.ts";
import {
  createEvent,
  deleteEvent,
  deleteEventTolerant,
  getFreshAccessToken,
  getOrCreateRooftapCalendar,
  updateEvent,
} from "../_shared/google-calendar.ts";
import type { GoogleCalendarConnection, GoogleEventInput } from "../_shared/google-calendar.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type EntityType = "task" | "appointment";
type TriggerOp = "INSERT" | "UPDATE" | "DELETE";
type EntityRecord = Record<string, any>;

interface CalendarPushBody {
  entity_type: EntityType;
  type: TriggerOp;
  record: EntityRecord | null;
  old_record: EntityRecord | null;
}

function addDaysToISODate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// household_tasks.due_date/due_time are naive wall-clock values with no zone of
// their own (see supabase/migrations/20260617000002_add_household_task_due_time.sql).
// FLUX-228 adds a per-user user_settings.timezone (defaulting to this same
// value, so existing users see no behavior change) — this constant now only
// serves as the defensive fallback when that column is somehow null.
const FALLBACK_CALENDAR_TIMEZONE = "Australia/Sydney";

// Base URL for deep links back into Rooftap from a pushed calendar event's
// description. No such env var existed yet for Edge Functions; left unset in
// environments that haven't configured it, in which case the link is omitted
// rather than guessing a domain.
const SITE_URL = Deno.env.get("SITE_URL") ?? "";

/** Appends a "view in Rooftap" deep link to `notes`, when SITE_URL is configured. */
function buildEventDescription(notes: string | null | undefined, path: string): string | null {
  const parts: string[] = [];
  if (notes) parts.push(notes);
  if (SITE_URL) parts.push(`View in Rooftap: ${SITE_URL}${path}`);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** Adds `minutes` to a due_date/due_time wall-clock pair, rolling the date over as needed. */
function addMinutesToWallClock(
  date: string,
  time: string,
  minutes: number,
): { date: string; time: string } {
  const [h, m] = time.split(":").map(Number);
  let totalMinutes = h * 60 + m + minutes;
  let dayOffset = 0;
  while (totalMinutes >= 1440) {
    totalMinutes -= 1440;
    dayOffset++;
  }
  while (totalMinutes < 0) {
    totalMinutes += 1440;
    dayOffset--;
  }
  return {
    date: dayOffset !== 0 ? addDaysToISODate(date, dayOffset) : date,
    time: `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`,
  };
}

/** Whether this insert/update/delete signal means "remove any pushed events" (Decision 3). */
export function isRemoveSignal(
  entityType: EntityType,
  type: TriggerOp,
  record: EntityRecord | null,
  oldRecord: EntityRecord | null,
): boolean {
  if (type === "DELETE") return true;
  if (entityType !== "task" || !record) return false;

  // household_tasks never hard-deletes from the app; the real removal signal is
  // an UPDATE flipping `deleted` to true.
  if (record.deleted === true && oldRecord?.deleted !== true) return true;
  // Completing a non-recurring to-do removes its calendar event too.
  if (record.done === true && oldRecord?.done !== true && !record.recurrence_days) return true;
  // Undated to-dos are never pushed — if a due_date was cleared, remove any mapping.
  if (!record.due_date) return true;

  return false;
}

/** Current-state eligibility check (used by calendar-sync's back-fill scan). */
export function shouldBePushed(entityType: EntityType, record: EntityRecord): boolean {
  if (entityType === "appointment") return true;
  if (record.deleted === true) return false;
  if (record.done === true && !record.recurrence_days) return false;
  return Boolean(record.due_date);
}

/**
 * Resolves the connected member user_ids eligible to receive this entity's
 * event. Nobody is eligible while the household has Google Calendar off, or
 * the entity's own module (a task's owner, Home Search for a viewing), so the
 * push handler and calendar-sync's reconcile pass take those events back out.
 */
export async function resolveTargetMembers(
  admin: SupabaseClient,
  entityType: EntityType,
  record: EntityRecord,
  modulesFor: ModuleLookup,
): Promise<string[]> {
  let groupId: string | null = null;
  let candidateUserIds: string[] | null = null;

  if (entityType === "appointment") {
    const { data: apartment, error } = await admin
      .from("apartments")
      .select("group_id")
      .eq("id", record.apartment_id)
      .single();
    if (error) throw error;
    groupId = apartment.group_id;
  } else {
    groupId = record.group_id;
    // Private tasks push only to the assignee (Decision 3).
    if (record.private === true) candidateUserIds = record.assigned_to ? [record.assigned_to] : [];
  }

  if (!groupId) return [];
  const enabled = await modulesFor(groupId);
  const task = entityType === "task" ? { template_key: (record.template_key ?? null) as string | null } : null;
  if (!isGoogleCalendarPushEnabled(entityType, task, enabled)) return [];

  if (!candidateUserIds) {
    const { data: members, error } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);
    if (error) throw error;
    candidateUserIds = (members ?? []).map((m) => m.user_id as string);
  }
  if (candidateUserIds.length === 0) return [];

  const { data: connections, error: connErr } = await admin
    .from("google_calendar_connections")
    .select("user_id, push_todos_enabled")
    .in("user_id", candidateUserIds);
  if (connErr) throw connErr;
  // FLUX-233: push_todos_enabled is to-do-specific (Decision: appointment push
  // is unaffected) — only gate eligibility here for entityType === "task".
  const connected = new Set(
    (connections ?? [])
      .filter((c) => entityType !== "task" || c.push_todos_enabled === true)
      .map((c) => c.user_id as string),
  );
  return candidateUserIds.filter((id) => connected.has(id));
}

/** Builds the Google event body for `record` as seen by one specific member. */
export async function buildEventBody(
  admin: SupabaseClient,
  entityType: EntityType,
  record: EntityRecord,
  memberUserId: string,
): Promise<GoogleEventInput> {
  const { data: settings } = await admin
    .from("user_settings")
    .select(
      "appointment_duration_minutes, calendar_todo_mode, calendar_todo_default_time, calendar_todo_default_duration_minutes, timezone, reminder_lead_days",
    )
    .eq("user_id", memberUserId)
    .maybeSingle();

  const timeZone = settings?.timezone ?? FALLBACK_CALENDAR_TIMEZONE;
  // Opt-in only: a member with no reminder_lead_days set gets no `reminders`
  // field at all, so the event inherits the calendar's own default reminders
  // (unchanged behavior).
  // Google rejects reminder overrides above 40320 minutes (28 days) with a 400.
  const GOOGLE_MAX_REMINDER_MINUTES = 40320;
  const reminders =
    settings?.reminder_lead_days != null
      ? {
          useDefault: false,
          overrides: [
            {
              method: "popup" as const,
              minutes: Math.min(
                GOOGLE_MAX_REMINDER_MINUTES,
                Math.max(0, settings.reminder_lead_days) * 24 * 60,
              ),
            },
          ],
        }
      : undefined;

  if (entityType === "appointment") {
    const { data: apartment, error } = await admin
      .from("apartments")
      .select("address")
      .eq("id", record.apartment_id)
      .single();
    if (error) throw error;

    const durationMinutes = settings?.appointment_duration_minutes ?? 20;

    const start = new Date(record.scheduled_at);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    return {
      summary: `Viewing: ${apartment.address}`,
      description: buildEventDescription(record.notes, "/calendar"),
      location: apartment.address,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      reminders,
    };
  }

  // task
  if (record.due_time) {
    // due_time is a naive wall-clock string (no zone) — hand Google a naive
    // dateTime + an explicit timeZone so IT resolves the absolute instant;
    // this avoids ever treating the wall clock as UTC (see timeZone above).
    const end = addMinutesToWallClock(record.due_date, record.due_time, 30);
    return {
      summary: record.title,
      description: buildEventDescription(record.notes, "/tasks"),
      start: { dateTime: `${record.due_date}T${record.due_time}:00`, timeZone },
      end: { dateTime: `${end.date}T${end.time}:00`, timeZone },
      reminders,
    };
  }

  // Undated (due_date only) task: 'all_day' (default, unchanged) or an opt-in
  // fixed-length 'timed_block' at the member's configured time-of-day.
  if (settings?.calendar_todo_mode === "timed_block") {
    const blockStartTime = settings.calendar_todo_default_time ?? "09:00";
    const blockDurationMinutes = settings.calendar_todo_default_duration_minutes ?? 30;
    const end = addMinutesToWallClock(record.due_date, blockStartTime, blockDurationMinutes);
    return {
      summary: record.title,
      description: buildEventDescription(record.notes, "/tasks"),
      start: { dateTime: `${record.due_date}T${blockStartTime}:00`, timeZone },
      end: { dateTime: `${end.date}T${end.time}:00`, timeZone },
      reminders,
    };
  }
  return {
    summary: record.title,
    description: buildEventDescription(record.notes, "/tasks"),
    // All-day events: Google's end.date is exclusive, so a 1-day event needs
    // end.date = start.date + 1.
    start: { date: record.due_date },
    end: { date: addDaysToISODate(record.due_date, 1) },
    reminders,
  };
}

/** Creates or updates the Google event for one member, upserting the mapping row. */
export async function pushEntityForMember(
  admin: SupabaseClient,
  entityType: EntityType,
  entityId: string,
  memberUserId: string,
  eventBody: GoogleEventInput,
): Promise<void> {
  const { data: connection, error: connErr } = await admin
    .from("google_calendar_connections")
    .select("*")
    .eq("user_id", memberUserId)
    .maybeSingle();
  if (connErr) throw connErr;
  if (!connection) return;

  const accessToken = await getFreshAccessToken(admin, connection as GoogleCalendarConnection);
  const calendarId = await getOrCreateRooftapCalendar(admin, accessToken, connection as GoogleCalendarConnection);

  const { data: existing, error: existingErr } = await admin
    .from("google_calendar_pushed_events")
    .select("gcal_event_id, origin")
    .eq("user_id", memberUserId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing) {
    if (existing.origin === "import") {
      // This member imported the original Google event themselves (Decision 6
      // echo control) — the mapped gcal_event_id is THEIR OWN pre-existing
      // event, not one Rooftap created. Never write to it — just bump
      // synced_at so calendar-sync's staleness check doesn't keep re-calling
      // this no-op every reconcile pass.
      const { error } = await admin
        .from("google_calendar_pushed_events")
        .update({ synced_at: new Date().toISOString() })
        .eq("user_id", memberUserId)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId);
      if (error) throw error;
      return;
    }
    // `existing.gcal_event_id` may live in the legacy "primary" calendar (an
    // event pushed before the dedicated Rooftap calendar existed — those are
    // never migrated, per FLUX-228's explicit decision) or in the newly
    // resolved Rooftap calendar (a mapping created after this shipped). Try the
    // resolved calendar first and fall back to "primary" on a 404 there.
    try {
      await updateEvent(accessToken, calendarId, existing.gcal_event_id, eventBody);
    } catch (err) {
      if (calendarId !== "primary" && (err as { status?: number }).status === 404) {
        await updateEvent(accessToken, "primary", existing.gcal_event_id, eventBody);
      } else {
        throw err;
      }
    }
    const { error } = await admin
      .from("google_calendar_pushed_events")
      .update({ synced_at: new Date().toISOString() })
      .eq("user_id", memberUserId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId);
    if (error) throw error;
  } else {
    const created = await createEvent(accessToken, calendarId, eventBody);
    const { error } = await admin.from("google_calendar_pushed_events").insert({
      user_id: memberUserId,
      entity_type: entityType,
      entity_id: entityId,
      gcal_event_id: created.id,
      synced_at: new Date().toISOString(),
      origin: "push",
    });
    if (error) {
      // Unique-violation: a concurrent invocation (e.g. an INSERT and a
      // near-simultaneous UPDATE trigger both firing calendar-push) already
      // won the race and inserted the mapping row first. Delete the duplicate
      // Google event we just created rather than leaving an orphaned copy —
      // the winner's mapping/event stands. It was just created in `calendarId`
      // this same call, so no "primary" fallback is needed here.
      if ((error as { code?: string }).code === "23505") {
        await deleteEvent(accessToken, calendarId, created.id).catch((delErr) =>
          console.error("calendar-push: failed to clean up duplicate event after race", delErr),
        );
        return;
      }
      throw error;
    }
  }
}

/** Deletes one member's pushed Google event for this entity and clears their mapping row. */
export async function removeMemberPush(
  admin: SupabaseClient,
  entityType: EntityType,
  entityId: string,
  memberUserId: string,
): Promise<void> {
  const { data: mapping, error } = await admin
    .from("google_calendar_pushed_events")
    .select("gcal_event_id, origin")
    .eq("user_id", memberUserId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (error) throw error;
  if (!mapping) return;

  if (mapping.origin !== "import") {
    try {
      const { data: connection } = await admin
        .from("google_calendar_connections")
        .select("*")
        .eq("user_id", memberUserId)
        .maybeSingle();
      if (connection) {
        const accessToken = await getFreshAccessToken(admin, connection as GoogleCalendarConnection);
        const calendarId = await getOrCreateRooftapCalendar(admin, accessToken, connection as GoogleCalendarConnection);
        await deleteEventTolerant(accessToken, calendarId, mapping.gcal_event_id);
      }
    } catch (err) {
      console.error("calendar-push: failed to delete Google event", memberUserId, entityType, entityId, err);
    }
  }
  // origin === 'import': gcal_event_id is the member's own pre-existing Google
  // event (Decision 6 echo control) — never delete it, only clear the mapping.

  const { error: deleteErr } = await admin
    .from("google_calendar_pushed_events")
    .delete()
    .eq("user_id", memberUserId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (deleteErr) throw deleteErr;
}

/** Deletes every member's pushed Google event for this entity and clears the mappings. */
export async function removeEntityPushes(
  admin: SupabaseClient,
  entityType: EntityType,
  entityId: string,
): Promise<void> {
  const { data: mappings, error } = await admin
    .from("google_calendar_pushed_events")
    .select("user_id, gcal_event_id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (error) throw error;
  if (!mappings || mappings.length === 0) return;

  for (const mapping of mappings) {
    try {
      await removeMemberPush(admin, entityType, entityId, mapping.user_id as string);
    } catch (err) {
      console.error("calendar-push: failed to remove member push", mapping, err);
    }
  }
}

async function handleRequest(req: Request): Promise<Response> {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as CalendarPushBody;
    const { entity_type, type, record, old_record } = body;
    const entityId = (record?.id ?? old_record?.id) as string | undefined;
    if (!entityId) return Response.json({ ok: true, skipped: "no entity id" });

    const admin = createAdmin();

    if (isRemoveSignal(entity_type, type, record, old_record)) {
      await removeEntityPushes(admin, entity_type, entityId);
      return Response.json({ ok: true, removed: true });
    }

    if (!record) return Response.json({ ok: true, skipped: "no record" });
    if (entity_type === "task" && !record.due_date) {
      return Response.json({ ok: true, skipped: "undated task" });
    }

    const memberIds = await resolveTargetMembers(admin, entity_type, record, createModuleLookup(admin));

    // Revoke pushes for members who hold a mapping but are no longer eligible
    // (e.g. a private task's assignee changed, or it flipped group-shared ->
    // private) — otherwise a stale Google event lingers on their calendar and
    // the 6h reconciler would keep pushing content updates to it (Decision 3).
    const { data: existingMappings, error: mapErr } = await admin
      .from("google_calendar_pushed_events")
      .select("user_id")
      .eq("entity_type", entity_type)
      .eq("entity_id", entityId);
    if (mapErr) throw mapErr;
    const eligible = new Set(memberIds);
    for (const mapping of existingMappings ?? []) {
      if (!eligible.has(mapping.user_id)) {
        try {
          await removeMemberPush(admin, entity_type, entityId, mapping.user_id as string);
        } catch (err) {
          console.error("calendar-push: failed to revoke ineligible member push", mapping.user_id, err);
        }
      }
    }

    let pushed = 0;
    for (const memberId of memberIds) {
      try {
        const eventBody = await buildEventBody(admin, entity_type, record, memberId);
        await pushEntityForMember(admin, entity_type, entityId, memberId, eventBody);
        pushed++;
      } catch (err) {
        console.error("calendar-push: failed to push for member", memberId, err);
      }
    }

    return Response.json({ ok: true, members: memberIds.length, pushed });
  } catch (err) {
    console.error("calendar-push failed", err);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

// calendar-sync imports the fan-out helpers above, which pulls this whole module
// in as a dependency. Guard the listener so importing it doesn't register a
// second Deno.serve in calendar-sync's isolate — only the function actually
// invoked as the entrypoint (import.meta.main) starts listening.
if (import.meta.main) {
  Deno.serve(handleRequest);
}
