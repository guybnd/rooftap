// HOUP-443: native calls to /api/assistant, through core's shared client so
// request shapes match web. Same authed pattern as features/shopper/shopper-api.ts:
// the server origin plus the Supabase session as `Authorization: Bearer`.
// Web twin: apps/web/src/lib/assistant-client.ts.
import { assistantError, createAssistantApi } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

export const assistantApi = createAssistantApi(async (path, init) => {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');
  const {
    data: { session },
  } = await getCurrentSupabaseClient().auth.getSession();
  const res = await fetch(`${server.origin}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw assistantError(res.status, body);
  return body as never;
});
