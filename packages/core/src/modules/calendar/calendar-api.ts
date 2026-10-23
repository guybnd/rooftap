// One client for /api/calendar/* (the Google Calendar overlay); each app
// passes its own `send`: web's fetch, or native's absolute-origin fetch with
// the session's Bearer token.
import type { GoogleCalendarEventWithAttribution } from '../../types';

/** The app's request: a JSON `body` goes out as JSON. Resolves to the raw response. */
export type CalendarSend = (
  path: string,
  init?: { method?: string; body?: unknown }
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export type CalendarActionError = 'already_imported' | 'unknown';

export interface CalendarActionResult {
  ok: boolean;
  error?: CalendarActionError;
}

export function createCalendarApi(send: CalendarSend) {
  const post = async (path: string, body: Record<string, unknown>): Promise<CalendarActionResult> => {
    const res = await send(path, { method: 'POST', body });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return { ok: false, error: data?.error === 'already_imported' ? 'already_imported' : 'unknown' };
  };

  return {
    /** Whether this person's Google Calendar is connected, or null when the server didn't answer. */
    status: async (): Promise<{ connected: boolean } | null> => {
      const res = await send('/api/calendar/status');
      if (!res.ok) return null;
      const data = (await res.json()) as { connected?: unknown } | null;
      return { connected: !!data?.connected };
    },
    /** Pulled events in [from, to), or null when the server didn't answer. */
    events: async (from: Date, to: Date): Promise<GoogleCalendarEventWithAttribution[] | null> => {
      const res = await send(
        `/api/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { events?: GoogleCalendarEventWithAttribution[] } | null;
      return data?.events ?? [];
    },
    dismiss: (eventId: string) => post('/api/calendar/dismiss', { eventId }),
    importAsTask: (eventId: string) => post('/api/calendar/import', { eventId, target: 'task' }),
    importAsAppointment: (eventId: string, apartmentId: string) =>
      post('/api/calendar/import', { eventId, target: 'appointment', apartmentId }),
    share: (eventId: string) => post('/api/calendar/share', { eventId }),
    unshare: (eventId: string) => post('/api/calendar/unshare', { eventId }),
  };
}

export type CalendarApi = ReturnType<typeof createCalendarApi>;
