// HOUP-100: native calls to /api/calendar/* — absolute-origin fetch (native
// has no cookie jar for the web origin) with a Bearer access token attached,
// same pattern as users-manager.tsx:42-58. The backend's getSessionUser()
// (apps/web/src/lib/supabase/session.ts) now accepts this header as a
// fallback to the cookie path.
import type { GoogleCalendarEventWithAttribution } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');

  const supabase = getCurrentSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return fetch(`${server.origin}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...init?.headers,
    },
  });
}

export interface CalendarStatus {
  connected: boolean;
}

export async function fetchCalendarStatus(): Promise<CalendarStatus> {
  const res = await authedFetch('/api/calendar/status');
  if (!res.ok) return { connected: false };
  const data = await res.json();
  return { connected: !!data.connected };
}

export async function fetchCalendarEvents(from: Date, to: Date): Promise<GoogleCalendarEventWithAttribution[]> {
  const res = await authedFetch(
    `/api/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.events ?? [];
}

export type CalendarActionError = 'already_imported' | 'unknown';

export interface CalendarActionResult {
  ok: boolean;
  error?: CalendarActionError;
}

async function postCalendarAction(path: string, body: Record<string, unknown>): Promise<CalendarActionResult> {
  const res = await authedFetch(path, { method: 'POST', body: JSON.stringify(body) });
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => null);
  return { ok: false, error: data?.error === 'already_imported' ? 'already_imported' : 'unknown' };
}

export function dismissCalendarEvent(eventId: string): Promise<CalendarActionResult> {
  return postCalendarAction('/api/calendar/dismiss', { eventId });
}

export function importCalendarEventAsTask(eventId: string): Promise<CalendarActionResult> {
  return postCalendarAction('/api/calendar/import', { eventId, target: 'task' });
}

export function importCalendarEventAsAppointment(eventId: string, apartmentId: string): Promise<CalendarActionResult> {
  return postCalendarAction('/api/calendar/import', { eventId, target: 'appointment', apartmentId });
}

export function shareCalendarEvent(eventId: string): Promise<CalendarActionResult> {
  return postCalendarAction('/api/calendar/share', { eventId });
}

export function unshareCalendarEvent(eventId: string): Promise<CalendarActionResult> {
  return postCalendarAction('/api/calendar/unshare', { eventId });
}
