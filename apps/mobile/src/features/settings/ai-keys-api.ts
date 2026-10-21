// HOUP-436: native calls to /api/ai-keys (Settings > AI keys). Same
// authedFetch pattern as features/shopper/shopper-api.ts.
import type { AiKeyProvider, HouseholdAiKeysStatus } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');
  const {
    data: { session },
  } = await getCurrentSupabaseClient().auth.getSession();
  const res = await fetch(`${server.origin}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export function householdAiKeys(): Promise<HouseholdAiKeysStatus> {
  return call('/api/ai-keys');
}

export function saveHouseholdAiKey(provider: AiKeyProvider, key: string): Promise<void> {
  return call('/api/ai-keys', { method: 'PUT', body: JSON.stringify({ provider, key }) });
}

export function removeHouseholdAiKey(provider: AiKeyProvider): Promise<void> {
  return call(`/api/ai-keys?provider=${provider}`, { method: 'DELETE' });
}
