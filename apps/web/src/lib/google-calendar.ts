import { createAdminClient } from "@/lib/supabase/admin";
import { resolveServerKey } from "@/lib/admin-config";
import type { GoogleCalendarConnection } from '@homeup/core';

// FLUX-157: server-only Google Calendar REST client (plain fetch, no
// googleapis SDK dependency). Used by the /api/calendar/* routes in this
// Next.js app. The calendar-push/calendar-sync Edge Functions run on Deno and
// have their OWN copy of this logic under supabase/functions/_shared/ — keep
// the response shapes documented below in sync if either side changes.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface GoogleEventDTO {
  id: string;
  htmlLink: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  /** ISO datetime (timed event) or ISO date (all-day event) — mirrors Google's start.dateTime / start.date. */
  start: string | null;
  /** ISO datetime (timed event) or ISO date (all-day event) — mirrors Google's end.dateTime / end.date. */
  end: string | null;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
}

interface GoogleRawEventItem {
  id: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/**
 * Shape of the body accepted by createEvent/updateEvent. Kept permissive
 * (index signature) since both functions forward it to Google verbatim via
 * JSON.stringify — this type exists to document the fields callers commonly
 * set, not to restrict what can be sent.
 */
export interface GoogleEventInput {
  summary?: string;
  description?: string | null;
  location?: string | null;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  /** FLUX-228: reminder overrides for pushed events (deep-link/reminder payload enrichment). */
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: "popup" | "email"; minutes: number }>;
  };
  [key: string]: unknown;
}

/** POST https://oauth2.googleapis.com/token with grant_type=refresh_token. Throws on non-200. */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const [clientId, clientSecret] = await Promise.all([
    resolveServerKey("GOOGLE_CLIENT_ID"),
    resolveServerKey("GOOGLE_CLIENT_SECRET"),
  ]);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`refreshAccessToken failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as GoogleTokenResponse;
  return { access_token: data.access_token, expires_in: data.expires_in };
}

/**
 * Returns a valid access token for the connection, refreshing (and
 * persisting the refresh back onto google_calendar_connections) if the
 * current token is within 5 minutes of expiry.
 */
export async function getFreshAccessToken(connection: GoogleCalendarConnection): Promise<string> {
  const expiresAt = new Date(connection.expires_at).getTime();
  if (expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return connection.access_token;
  }

  const { access_token, expires_in } = await refreshAccessToken(connection.refresh_token);
  const admin = createAdminClient();
  const { error } = await admin
    .from("google_calendar_connections")
    .update({
      access_token,
      expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
    })
    .eq("user_id", connection.user_id);
  if (error) throw error;

  return access_token;
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

/** GET .../users/me/calendarList — the account's list of calendars the user can select to pull from. */
export async function listCalendars(
  accessToken: string
): Promise<{ id: string; summary: string; primary?: boolean }[]> {
  const res = await fetch(`${CALENDAR_API_BASE}/users/me/calendarList`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`listCalendars failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { items?: GoogleCalendarListItem[] };
  const items = data.items ?? [];
  return items.map((item) => ({
    id: item.id,
    summary: item.summary,
    primary: item.primary ?? undefined,
  }));
}

/**
 * Returns the id of the connection's dedicated "Rooftap" Google Calendar,
 * creating it (and persisting the id) on first use. Idempotent under retry —
 * a stored id that no longer resolves (404, e.g. deleted by the user) falls
 * through to creating a new one rather than throwing.
 */
export async function getOrCreateRooftapCalendar(
  accessToken: string,
  connection: GoogleCalendarConnection
): Promise<string> {
  if (connection.homeup_calendar_id) {
    const res = await fetch(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(connection.homeup_calendar_id)}`,
      { headers: authHeaders(accessToken) }
    );
    if (res.ok) {
      return connection.homeup_calendar_id;
    }
    if (res.status !== 404) {
      const body = await res.text().catch(() => "");
      throw new Error(`getOrCreateRooftapCalendar verify failed (${res.status}): ${body}`);
    }
  }

  const createRes = await fetch(`${CALENDAR_API_BASE}/calendars`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ summary: "Rooftap" }),
  });
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(`getOrCreateRooftapCalendar create failed (${createRes.status}): ${body}`);
  }
  const data = (await createRes.json()) as { id: string };

  const admin = createAdminClient();
  const { error } = await admin
    .from("google_calendar_connections")
    .update({ homeup_calendar_id: data.id })
    .eq("user_id", connection.user_id);
  if (error) throw error;

  return data.id;
}

/**
 * GET .../calendars/{calendarId}/events?singleEvents=true&orderBy=startTime
 * within [timeMinISO, timeMaxISO]. Response shape (Google's `items[]`, mapped
 * down to GoogleEventDTO): each item has `id`, `htmlLink`, `summary`,
 * `description`, `location`, and `start`/`end` objects that carry EITHER a
 * `dateTime` (timed event) or a `date` (all-day event) — never both. The Deno
 * twin in supabase/functions/_shared/ must mirror this same start/end
 * dateTime-or-date fallback.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMinISO: string,
  timeMaxISO: string
): Promise<GoogleEventDTO[]> {
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
  });
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    { headers: authHeaders(accessToken) }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`listEvents failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { items?: GoogleRawEventItem[] };
  const items = data.items ?? [];
  return items.map((item) => ({
    id: item.id,
    htmlLink: item.htmlLink ?? null,
    summary: item.summary ?? null,
    description: item.description ?? null,
    location: item.location ?? null,
    start: item.start?.dateTime ?? item.start?.date ?? null,
    end: item.end?.dateTime ?? item.end?.date ?? null,
  }));
}

/** POST .../calendars/{calendarId}/events — creates a new Google event, returns its id. */
export async function createEvent(
  accessToken: string,
  calendarId: string,
  body: GoogleEventInput
): Promise<{ id: string; htmlLink: string | null }> {
  const res = await fetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`createEvent failed (${res.status}): ${errBody}`);
  }
  const data = await res.json();
  return { id: data.id, htmlLink: data.htmlLink ?? null };
}

/** PATCH .../calendars/{calendarId}/events/{eventId} — partial update of an existing Google event. */
export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: GoogleEventInput
): Promise<{ id: string; htmlLink: string | null }> {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`updateEvent failed (${res.status}): ${errBody}`);
  }
  const data = await res.json();
  return { id: data.id, htmlLink: data.htmlLink ?? null };
}

/** DELETE .../calendars/{calendarId}/events/{eventId}. A 404/410 (already gone) is not thrown — treated as success. */
export async function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    }
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const body = await res.text().catch(() => "");
    throw new Error(`deleteEvent failed (${res.status}): ${body}`);
  }
}

/** POST https://oauth2.googleapis.com/revoke?token=... — revokes an access or refresh token. */
export async function revokeToken(token: string): Promise<void> {
  const res = await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`revokeToken failed (${res.status}): ${body}`);
  }
}
