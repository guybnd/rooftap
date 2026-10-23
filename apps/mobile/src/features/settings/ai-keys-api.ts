// HOUP-436: native calls to /api/ai-keys (Settings > AI keys). Same
// authedFetch pattern as features/shopper/shopper-api.ts.
import type { AiKeyProvider, AiProvidersStatus, FeedbackInbox, HouseholdAiKeysStatus } from '@homeup/core';
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
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? `Request failed (${res.status})`), { status: res.status });
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

/** Settings > AI providers (server operators only); a 403 or 404 hides the panel. */
export function aiProviders(): Promise<AiProvidersStatus> {
  return call('/api/admin/ai-providers');
}

/** `{ settings }` or `{ key: { provider, value } }`; answers the new status. */
export function saveAiProviders(body: unknown): Promise<AiProvidersStatus> {
  return call('/api/admin/ai-providers', { method: 'PUT', body: JSON.stringify(body) });
}

/** Whether this server has the AI providers panel, so the API keys panel can step aside. */
export async function hasAiProvidersPanel(): Promise<boolean> {
  try {
    await aiProviders();
    return true;
  } catch {
    return false;
  }
}

/** Settings > Feedback (server operators only); a 403 or 404 hides the panel. */
export function feedbackInbox(): Promise<FeedbackInbox> {
  return call('/api/admin/feedback');
}

/** Marks one piece of feedback dealt with, or back to new; answers the inbox. */
export function setFeedbackDone(id: string, done: boolean): Promise<FeedbackInbox> {
  return call('/api/admin/feedback', { method: 'PATCH', body: JSON.stringify({ id, done }) });
}
