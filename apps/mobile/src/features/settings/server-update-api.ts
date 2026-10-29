// GET /api/server-update (core app-release.ts, server-updater.ts): a newer
// server release and the one-click updater's progress, told only to the
// people who run the server. POST /api/server-update/install starts an
// update. Same authedFetch pattern as ai-keys-api.ts: the server's origin
// plus the session's Bearer token.
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');
  const {
    data: { session },
  } = await getCurrentSupabaseClient().auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in.');
  return fetch(`${server.origin}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${session.access_token}` },
  });
}

export async function fetchServerUpdate(): Promise<unknown> {
  const res = await authed('/api/server-update');
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  return res.json();
}

export async function startServerUpdate(version: string): Promise<void> {
  const res = await authed('/api/server-update/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'The server could not start the update.');
  }
}
