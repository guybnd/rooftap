// FLUX-157: Deno-flavored Google Calendar REST client for the calendar-push /
// calendar-sync Edge Functions. This is a twin of src/lib/google-calendar.ts
// (Node/Next.js) — Deno can't resolve that module graph, so the two are kept
// separate on purpose. Do not import across them.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export interface GoogleCalendarConnection {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scopes: string;
  selected_calendar_ids: string[];
  suggest_mode: "dedicated" | "keywords" | "both";
  dedicated_calendar_id: string | null;
  keywords: string[];
  /** FLUX-228: id of the dedicated "Rooftap" calendar pushes target; null until first push after rollout. */
  homeup_calendar_id: string | null;
  pull_window_past_days: number;
  pull_window_future_days: number;
  default_import_visibility: "private" | "group";
  /** FLUX-233: whether calendar-sync should pull this connection's calendars at all. */
  pull_enabled: boolean;
  /** FLUX-233: whether to-dos (household_tasks) should be pushed to this member's calendar. Appointments are unaffected. */
  push_todos_enabled: boolean;
}

export interface GoogleEventTime {
  dateTime?: string;
  date?: string;
  /** IANA zone for a naive (no-offset) `dateTime` — lets Google resolve the wall clock without us doing any UTC math. */
  timeZone?: string;
}

export interface GoogleEventInput {
  summary: string;
  description?: string | null;
  location?: string | null;
  start: GoogleEventTime;
  end: GoogleEventTime;
  /** FLUX-228: reminder overrides (e.g. derived from user_settings.reminder_lead_days). Omit to inherit the calendar's default reminders. */
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: "popup" | "email"; minutes: number }>;
  };
}

export interface PulledEvent {
  gcalEventId: string;
  htmlLink: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  isAllDay: boolean;
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
    }),
  });
  if (!res.ok) {
    throw new Error(`refreshAccessToken failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Returns a valid access token for `connection`, refreshing (and persisting the
 * refresh back to google_calendar_connections) when the current token is within
 * 5 minutes of expiry.
 */
export async function getFreshAccessToken(
  admin: SupabaseClient,
  connection: GoogleCalendarConnection,
): Promise<string> {
  const expiresAt = new Date(connection.expires_at).getTime();
  const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
  if (expiresAt > fiveMinFromNow) {
    return connection.access_token;
  }

  const refreshed = await refreshAccessToken(connection.refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  const { error } = await admin
    .from("google_calendar_connections")
    .update({ access_token: refreshed.access_token, expires_at: newExpiresAt })
    .eq("user_id", connection.user_id);
  if (error) throw error;

  // Mutate in place so callers holding this same `connection` object (loops over
  // several entities for one member in a single request) see the refreshed token.
  connection.access_token = refreshed.access_token;
  connection.expires_at = newExpiresAt;
  return refreshed.access_token;
}

/**
 * Resolves the per-connection dedicated "Rooftap" Google Calendar, creating it
 * on first use and persisting its id back onto the connection row. Idempotent
 * under retry/concurrency: a stored `homeup_calendar_id` is verified live
 * (a 404 means it was deleted on Google's side) before ever creating a new
 * one, so a connection never ends up with two Rooftap calendars.
 */
export async function getOrCreateRooftapCalendar(
  admin: SupabaseClient,
  accessToken: string,
  connection: GoogleCalendarConnection,
): Promise<string> {
  if (connection.homeup_calendar_id) {
    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(connection.homeup_calendar_id)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.ok) return connection.homeup_calendar_id;
    if (res.status !== 404) {
      throw new Error(`getOrCreateRooftapCalendar verify failed: ${res.status} ${await res.text()}`);
    }
    // 404: the stored calendar was deleted on Google's side — fall through and recreate.
  }

  const createRes = await fetch(`${CALENDAR_API}/calendars`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ summary: "Rooftap" }),
  });
  if (!createRes.ok) {
    throw new Error(`getOrCreateRooftapCalendar create failed: ${createRes.status} ${await createRes.text()}`);
  }
  const created = await createRes.json();
  const calendarId = created.id as string;

  const { error } = await admin
    .from("google_calendar_connections")
    .update({ homeup_calendar_id: calendarId })
    .eq("user_id", connection.user_id);
  if (error) throw error;

  // Mutate in place so callers holding this same `connection` object (a single
  // push invocation resolves this once and reuses it) see the new id, mirroring
  // getFreshAccessToken's in-place token refresh above.
  connection.homeup_calendar_id = calendarId;
  return calendarId;
}

/** List events on one calendar within [timeMinISO, timeMaxISO), recurring events pre-expanded. */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMinISO: string,
  timeMaxISO: string,
): Promise<PulledEvent[]> {
  const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", timeMinISO);
  url.searchParams.set("timeMax", timeMaxISO);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`listEvents failed: ${res.status} ${await res.text()}`);
  }
  interface RawGoogleEvent {
    id: string;
    status?: string;
    htmlLink?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }
  const body = await res.json();
  const items = (body.items ?? []) as RawGoogleEvent[];

  return items
    // Cancelled instances within the window carry no `start`; nothing to map.
    .filter((item) => item.status !== "cancelled" && item.start)
    .map((item) => ({
      gcalEventId: item.id,
      htmlLink: item.htmlLink ?? null,
      title: item.summary ?? null,
      description: item.description ?? null,
      location: item.location ?? null,
      startsAt: item.start.dateTime ?? item.start.date,
      endsAt: item.end?.dateTime ?? item.end?.date ?? null,
      isAllDay: !item.start.dateTime,
    }));
}

async function writeEvent(
  accessToken: string,
  calendarId: string,
  method: "POST" | "PATCH",
  path: string,
  body: GoogleEventInput,
): Promise<{ id: string; htmlLink: string | null }> {
  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: body.summary,
      description: body.description ?? undefined,
      location: body.location ?? undefined,
      start: body.start,
      end: body.end,
      reminders: body.reminders ?? undefined,
    }),
  });
  if (!res.ok) {
    const err = new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return { id: json.id, htmlLink: json.htmlLink ?? null };
}

export function createEvent(
  accessToken: string,
  calendarId: string,
  body: GoogleEventInput,
): Promise<{ id: string; htmlLink: string | null }> {
  return writeEvent(accessToken, calendarId, "POST", "/events", body);
}

export function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: GoogleEventInput,
): Promise<{ id: string; htmlLink: string | null }> {
  return writeEvent(accessToken, calendarId, "PATCH", `/events/${encodeURIComponent(eventId)}`, body);
}

/** Deletes a Google event. 404/410 (already gone) are treated as success. */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`deleteEvent failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Deletes an event that may live in either `calendarId` (the resolved Rooftap
 * calendar) or the legacy "primary" calendar (a pre-FLUX-228 push, never
 * migrated — see getOrCreateRooftapCalendar above). Tries `calendarId` first;
 * if Google reports the event missing there, retries against "primary"
 * before treating it as gone. A no-op (success) if it's genuinely gone from
 * both.
 */
export async function deleteEventTolerant(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  if (calendarId === "primary") return deleteEvent(accessToken, calendarId, eventId);

  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.ok) return;
  if (res.status !== 404 && res.status !== 410) {
    throw new Error(`deleteEvent failed: ${res.status} ${await res.text()}`);
  }
  // Not found in the resolved calendar — may be a pre-migration event still
  // sitting in "primary". deleteEvent itself treats a 404/410 there as
  // "already gone", so this is a safe final attempt either way.
  return deleteEvent(accessToken, "primary", eventId);
}
