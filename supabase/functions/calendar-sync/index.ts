// FLUX-157: periodic Google Calendar sync (Decision 4 + 5). Invoked every 6h by
// pg_cron via notify_edge_function('calendar-sync', '{}') — see migration
// 20260713000001_create_google_calendar_tables.sql for the cron schedule.
//
// For every connection: pulls each selected calendar into google_calendar_events
// (staging table for the read-only overlay), classifies pulled events as
// suggestions, and fuzzy-matches them against the group's apartments. Then, once
// globally, reconciles the push side: re-push stale mappings, back-fill members
// who connected Google after an entity was already pushed, and delete orphaned
// mappings whose entity no longer exists.
//
// Modules (.docs/modules.md): a member is pulled only while one of their
// households has Google Calendar on, viewings are matched only against
// households with Home Search on, and resolveTargetMembers drops pushes whose
// module is off, so the reconcile pass takes those events back out.
import { createAdmin, requireServiceRole } from "../_shared/send-push.ts";
import { createModuleLookup, type ModuleLookup } from "../_shared/modules.ts";
import {
  deleteEventTolerant,
  getFreshAccessToken,
  getOrCreateRooftapCalendar,
  listEvents,
} from "../_shared/google-calendar.ts";
import type { GoogleCalendarConnection } from "../_shared/google-calendar.ts";
import {
  buildEventBody,
  pushEntityForMember,
  removeMemberPush,
  resolveTargetMembers,
  shouldBePushed,
} from "../calendar-push/index.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";

type EntityType = "task" | "appointment";
type EntityRecord = Record<string, any>;

// FLUX-228: these are now per-connection (pull_window_past_days/
// pull_window_future_days) — kept here only as the defensive fallback if a
// connection row somehow has a null value.
const FALLBACK_PULL_WINDOW_PAST_DAYS = 7;
const FALLBACK_PULL_WINDOW_FUTURE_DAYS = 30;

function isoOffsetDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function textIncludesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

/** Suggestion classifier + apartment fuzzy-match for one connection's pulled rows. */
/** The member's households that have each module on, by module id. */
async function memberGroupsWith(
  admin: SupabaseClient,
  userId: string,
  modulesFor: ModuleLookup,
  moduleId: string,
): Promise<string[]> {
  const { data: memberships, error } = await admin
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);
  if (error) throw error;
  const groupIds = (memberships ?? []).map((m) => m.group_id as string);
  const on: string[] = [];
  for (const groupId of groupIds) if ((await modulesFor(groupId)).has(moduleId)) on.push(groupId);
  return on;
}

async function classifyAndMatch(
  admin: SupabaseClient,
  connection: GoogleCalendarConnection,
  modulesFor: ModuleLookup,
): Promise<void> {
  const { data: rows, error } = await admin
    .from("google_calendar_events")
    .select("id, gcal_calendar_id, title, description, location, state")
    .eq("user_id", connection.user_id)
    .in("state", ["synced", "suggested"]);
  if (error) throw error;
  if (!rows || rows.length === 0) return;

  // Viewings are matched only against households with Home Search on.
  const groupIds = await memberGroupsWith(admin, connection.user_id, modulesFor, "search");

  let apartments: { id: string; address: string; suburb: string | null }[] = [];
  if (groupIds.length > 0) {
    const { data, error: apError } = await admin
      .from("apartments")
      .select("id, address, suburb")
      .in("group_id", groupIds);
    if (apError) throw apError;
    apartments = data ?? [];
  }

  for (const row of rows) {
    const patch: Record<string, unknown> = {};

    // Classifier only ever promotes rows still sitting in 'synced'.
    if (row.state === "synced") {
      const dedicatedMatch =
        (connection.suggest_mode === "dedicated" || connection.suggest_mode === "both") &&
        row.gcal_calendar_id === connection.dedicated_calendar_id;
      const keywordMatch =
        (connection.suggest_mode === "keywords" || connection.suggest_mode === "both") &&
        textIncludesAny(`${row.title ?? ""} ${row.description ?? ""}`, connection.keywords ?? []);
      if (dedicatedMatch || keywordMatch) patch.state = "suggested";
    }

    if (row.location) {
      const location = String(row.location).toLowerCase();
      const hit = apartments.find(
        (apartment) =>
          location.includes(apartment.address.toLowerCase()) ||
          (apartment.suburb && location.includes(apartment.suburb.toLowerCase())),
      );
      if (hit) patch.matched_apartment_id = hit.id;
    }

    if (Object.keys(patch).length > 0) {
      const { error: updateErr } = await admin.from("google_calendar_events").update(patch).eq("id", row.id);
      if (updateErr) throw updateErr;
    }
  }
}

/** Pulls every selected calendar for one connection into google_calendar_events. */
async function pullConnection(
  admin: SupabaseClient,
  connection: GoogleCalendarConnection,
  modulesFor: ModuleLookup,
): Promise<boolean> {
  // FLUX-233: pull is now an explicit opt-out — a connection with pull_enabled
  // false skips fetching entirely, same as if selected_calendar_ids were empty
  // and the user had never connected.
  if (connection.pull_enabled === false) return false;
  // Modules: nothing to pull for a member none of whose households has Google
  // Calendar on. Rows already pulled stay, hidden, until it comes back.
  if ((await memberGroupsWith(admin, connection.user_id, modulesFor, "google-calendar")).length === 0) return false;

  const accessToken = await getFreshAccessToken(admin, connection);
  const pastDays = connection.pull_window_past_days ?? FALLBACK_PULL_WINDOW_PAST_DAYS;
  const futureDays = connection.pull_window_future_days ?? FALLBACK_PULL_WINDOW_FUTURE_DAYS;
  const timeMin = isoOffsetDays(-pastDays);
  const timeMax = isoOffsetDays(futureDays);

  const { data: pushedRows, error: pushedErr } = await admin
    .from("google_calendar_pushed_events")
    .select("gcal_event_id")
    .eq("user_id", connection.user_id);
  if (pushedErr) throw pushedErr;
  const pushedIds = new Set((pushedRows ?? []).map((r) => r.gcal_event_id as string));

  for (const calendarId of connection.selected_calendar_ids?.length ? connection.selected_calendar_ids : ["primary"]) {
    const events = await listEvents(accessToken, calendarId, timeMin, timeMax);
    const fetchedIds = new Set<string>();

    for (const event of events) {
      // Echo control: never let Rooftap's own pushed events boomerang into the overlay.
      if (pushedIds.has(event.gcalEventId)) continue;
      fetchedIds.add(event.gcalEventId);

      const { data: existing, error: existingErr } = await admin
        .from("google_calendar_events")
        .select("id")
        .eq("user_id", connection.user_id)
        .eq("gcal_event_id", event.gcalEventId)
        .maybeSingle();
      if (existingErr) throw existingErr;

      const descriptiveFields = {
        title: event.title,
        description: event.description,
        location: event.location,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        is_all_day: event.isAllDay,
        html_link: event.htmlLink,
        gcal_calendar_id: calendarId,
      };

      if (existing) {
        // Deliberately never touches `state` — 'imported'/'dismissed' rows must
        // never be demoted back to 'synced'/'suggested' by a later pull.
        const { error: updateErr } = await admin
          .from("google_calendar_events")
          .update(descriptiveFields)
          .eq("id", existing.id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await admin.from("google_calendar_events").insert({
          user_id: connection.user_id,
          gcal_event_id: event.gcalEventId,
          state: "synced",
          visibility: connection.default_import_visibility ?? "private",
          ...descriptiveFields,
        });
        if (insertErr) throw insertErr;
      }
    }

    // Prune: rows previously pulled for this calendar that Google no longer
    // returns (deleted on Google's side) — never prune 'imported' rows.
    const { data: staleRows, error: staleErr } = await admin
      .from("google_calendar_events")
      .select("id, gcal_event_id")
      .eq("user_id", connection.user_id)
      .eq("gcal_calendar_id", calendarId)
      .neq("state", "imported");
    if (staleErr) throw staleErr;
    const toDelete = (staleRows ?? [])
      .filter((row) => !fetchedIds.has(row.gcal_event_id))
      .map((row) => row.id);
    if (toDelete.length > 0) {
      const { error: deleteErr } = await admin.from("google_calendar_events").delete().in("id", toDelete);
      if (deleteErr) throw deleteErr;
    }
  }

  // The per-calendar prune above only ever visits calendars still in
  // selected_calendar_ids, so a calendar the user fully DE-selects is never
  // visited again and its rows would otherwise orphan on the overlay forever.
  // Catch that here: delete any non-imported row whose gcal_calendar_id isn't
  // one of the currently selected calendars at all.
  const selectedIds = connection.selected_calendar_ids?.length ? connection.selected_calendar_ids : ["primary"];
  const { data: deselectedRows, error: deselectedErr } = await admin
    .from("google_calendar_events")
    .select("id, gcal_calendar_id")
    .eq("user_id", connection.user_id)
    .neq("state", "imported");
  if (deselectedErr) throw deselectedErr;
  const deselectedIds = (deselectedRows ?? [])
    .filter((row) => !selectedIds.includes(row.gcal_calendar_id))
    .map((row) => row.id);
  if (deselectedIds.length > 0) {
    const { error: deleteDeselectedErr } = await admin.from("google_calendar_events").delete().in("id", deselectedIds);
    if (deleteDeselectedErr) throw deleteDeselectedErr;
  }

  await classifyAndMatch(admin, connection, modulesFor);
  return true;
}

async function fetchEntity(admin: SupabaseClient, entityType: EntityType, entityId: string): Promise<EntityRecord | null> {
  const table = entityType === "task" ? "household_tasks" : "appointments";
  const { data, error } = await admin.from(table).select("*").eq("id", entityId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// FLUX-243 scope guard: a settings change (e.g. calendar_todo_mode) must only
// retroactively re-push entities dated today or later — past pushed events are
// left untouched even after the member edits their settings.
function isDatedTodayOrFuture(entityType: EntityType, entity: EntityRecord): boolean {
  const relevantDate = entityType === "appointment" ? entity.scheduled_at : entity.due_date;
  if (!relevantDate) return false;
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  return new Date(relevantDate).getTime() >= todayStart.getTime();
}

/** Re-push stale mappings, back-fill missing members, and delete orphaned mappings (Decision 4). */
async function reconcilePush(
  admin: SupabaseClient,
  modulesFor: ModuleLookup,
): Promise<{ restaled: number; backfilled: number; orphansRemoved: number; revoked: number }> {
  let restaled = 0;
  let backfilled = 0;
  let orphansRemoved = 0;
  let revoked = 0;

  const { data: mappings, error: mapErr } = await admin
    .from("google_calendar_pushed_events")
    .select("user_id, entity_type, entity_id, gcal_event_id, synced_at");
  if (mapErr) throw mapErr;

  // Batched once for all mappings (not per-mapping) to avoid an N+1 query —
  // settings staleness needs each pushing member's user_settings.updated_at.
  const mappingUserIds = Array.from(new Set((mappings ?? []).map((m) => m.user_id as string)));
  const settingsUpdatedAtByUser = new Map<string, string>();
  if (mappingUserIds.length > 0) {
    const { data: settingsRows, error: settingsErr } = await admin
      .from("user_settings")
      .select("user_id, updated_at")
      .in("user_id", mappingUserIds);
    if (settingsErr) throw settingsErr;
    for (const row of settingsRows ?? []) {
      settingsUpdatedAtByUser.set(row.user_id as string, row.updated_at as string);
    }
  }

  for (const mapping of mappings ?? []) {
    try {
      const entity = await fetchEntity(admin, mapping.entity_type as EntityType, mapping.entity_id);
      if (!entity) {
        const { data: connection } = await admin
          .from("google_calendar_connections")
          .select("*")
          .eq("user_id", mapping.user_id)
          .maybeSingle();
        if (connection) {
          const accessToken = await getFreshAccessToken(admin, connection as GoogleCalendarConnection);
          const calendarId = await getOrCreateRooftapCalendar(admin, accessToken, connection as GoogleCalendarConnection);
          await deleteEventTolerant(accessToken, calendarId, mapping.gcal_event_id);
        }
        await admin
          .from("google_calendar_pushed_events")
          .delete()
          .eq("user_id", mapping.user_id)
          .eq("entity_type", mapping.entity_type)
          .eq("entity_id", mapping.entity_id);
        orphansRemoved++;
        continue;
      }

      // Re-check eligibility on every reconcile pass, not just staleness — a
      // mapping can go stale because the member fell OUT of eligibility
      // (reassigned away, flipped private, left the group), and staleness
      // alone would keep re-pushing content updates to their calendar
      // indefinitely (Decision 3 privacy leak).
      const eligibleMembers = await resolveTargetMembers(admin, mapping.entity_type as EntityType, entity, modulesFor);
      if (!eligibleMembers.includes(mapping.user_id)) {
        await removeMemberPush(admin, mapping.entity_type as EntityType, mapping.entity_id, mapping.user_id);
        revoked++;
        continue;
      }

      const syncedAtMs = new Date(mapping.synced_at).getTime();
      const entityStale = new Date(entity.updated_at).getTime() > syncedAtMs;

      // FLUX-243: a settings change (calendar_todo_mode, timezone, etc.) never
      // bumps the entity's own updated_at, so it was previously invisible to
      // the staleness check above — already-synced to-dos stayed stuck as
      // all-day events even after the member switched to timed_block. Scoped
      // to today/future entities only (see isDatedTodayOrFuture).
      const settingsUpdatedAt = settingsUpdatedAtByUser.get(mapping.user_id);
      const settingsStale =
        settingsUpdatedAt != null &&
        new Date(settingsUpdatedAt).getTime() > syncedAtMs &&
        isDatedTodayOrFuture(mapping.entity_type as EntityType, entity);

      if (entityStale || settingsStale) {
        const eventBody = await buildEventBody(admin, mapping.entity_type as EntityType, entity, mapping.user_id);
        await pushEntityForMember(admin, mapping.entity_type as EntityType, mapping.entity_id, mapping.user_id, eventBody);
        restaled++;
      }
    } catch (err) {
      console.error("calendar-sync: reconcile mapping failed", mapping, err);
    }
  }

  const [{ data: appointments, error: apErr }, { data: tasks, error: taskErr }] = await Promise.all([
    admin.from("appointments").select("*"),
    admin.from("household_tasks").select("*").eq("deleted", false),
  ]);
  if (apErr) throw apErr;
  if (taskErr) throw taskErr;

  const entities: { type: EntityType; record: EntityRecord }[] = [
    ...(appointments ?? []).map((r) => ({ type: "appointment" as const, record: r as EntityRecord })),
    ...(tasks ?? []).map((r) => ({ type: "task" as const, record: r as EntityRecord })),
  ];

  for (const { type, record } of entities) {
    if (!shouldBePushed(type, record)) continue;
    try {
      const memberIds = await resolveTargetMembers(admin, type, record, modulesFor);
      for (const memberId of memberIds) {
        const { data: existingMapping, error: existErr } = await admin
          .from("google_calendar_pushed_events")
          .select("user_id")
          .eq("user_id", memberId)
          .eq("entity_type", type)
          .eq("entity_id", record.id)
          .maybeSingle();
        if (existErr) throw existErr;
        if (existingMapping) continue;

        try {
          const eventBody = await buildEventBody(admin, type, record, memberId);
          await pushEntityForMember(admin, type, record.id, memberId, eventBody);
          backfilled++;
        } catch (err) {
          console.error("calendar-sync: backfill push failed", type, record.id, memberId, err);
        }
      }
    } catch (err) {
      console.error("calendar-sync: backfill resolve failed", type, record.id, err);
    }
  }

  return { restaled, backfilled, orphansRemoved, revoked };
}

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  try {
    const admin = createAdmin();
    const modulesFor = createModuleLookup(admin);
    const { data: connections, error } = await admin.from("google_calendar_connections").select("*");
    if (error) throw error;

    let pulled = 0;
    for (const connection of (connections ?? []) as GoogleCalendarConnection[]) {
      try {
        if (await pullConnection(admin, connection, modulesFor)) pulled++;
      } catch (err) {
        console.error("calendar-sync: pull failed for connection", connection.user_id, err);
      }
    }

    const reconciled = await reconcilePush(admin, modulesFor);

    return Response.json({
      ok: true,
      connections: (connections ?? []).length,
      pulled,
      ...reconciled,
    });
  } catch (err) {
    console.error("calendar-sync failed", err);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
});
