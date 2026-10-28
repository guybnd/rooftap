// GET /api/server-update (core app-release.ts): a newer server release, told
// only to the people who run the server. Same authedFetch pattern as
// ai-keys-api.ts: the server's origin plus the session's Bearer token.
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

export async function fetchServerUpdate(): Promise<unknown> {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');
  const {
    data: { session },
  } = await getCurrentSupabaseClient().auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in.');
  const res = await fetch(`${server.origin}/api/server-update`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  return res.json();
}
