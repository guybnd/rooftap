// HOUP-100: native calls to /api/calendar/*, through core's shared client so
// request shapes match web. Absolute-origin fetch (native has no cookie jar
// for the web origin) with a Bearer access token attached, same pattern as
// users-manager.tsx:42-58. The backend's getSessionUser()
// (apps/web/src/lib/supabase/session.ts) accepts this header as a fallback to
// the cookie path.
import { createCalendarApi } from '@homeup/core';
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

export const calendarApi = createCalendarApi((path, init) =>
  authedFetch(path, {
    method: init?.method,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
);
