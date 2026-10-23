// The calendar's forecast and travel lookups, through core's shared cache so
// both apps ask the same way. Web twin: apps/web/src/lib/event-lookups.ts.
// The request carries the session's Bearer token like calendar-api.ts.
import { createEventLookups } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

export const eventLookups = createEventLookups(async (path) => {
  const server = await getStoredServer();
  if (!server) return null;
  const {
    data: { session },
  } = await getCurrentSupabaseClient().auth.getSession();
  const res = await fetch(`${server.origin}${path}`, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  return res.ok ? res.json() : null;
});
