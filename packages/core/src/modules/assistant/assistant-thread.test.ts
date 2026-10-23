import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantConversation, AssistantMessage } from './assistant-api';

const conversation = (id: string, over: Partial<AssistantConversation> = {}): AssistantConversation =>
  ({ id, kind: 'chat', title: id, pinned: false, last_active_at: '2026-10-21T07:00:00Z', closes_at: null, pending: 0, unread: false, ...over }) as AssistantConversation;
const message = (id: string): AssistantMessage =>
  ({ id, role: 'assistant', content: id, author: null, channel: 'app', created_at: '2026-10-21T07:00:00Z', proposal: null, cost_micros: null }) as AssistantMessage;

// Each test loads a fresh module (the cache is module state) against a fresh device store.
async function load(store: Map<string, string>) {
  vi.resetModules();
  const env = await import('../../data/store-environment');
  env.configureStoreEnvironment({
    keyValue: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
  } as Parameters<typeof env.configureStoreEnvironment>[0]);
  return import('./assistant-thread');
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('thread cache on the device', () => {
  it('keeps read threads across a restart, without the household alias or unsent messages', async () => {
    const store = new Map<string, string>();
    const first = await load(store);
    first.rememberThread(conversation('h1', { kind: 'household' }), [message('m1')]);
    first.rememberThread(conversation('c1'), [message('m2'), message('local-1')]);
    vi.advanceTimersByTime(500);

    const second = await load(store);
    expect(second.cachedThread('c1')?.messages.map((m) => m.id)).toEqual(['m2']);
    expect(second.cachedThread('h1')?.conversation.kind).toBe('household');
    expect(second.cachedThread('household')).toBeNull();
    expect(second.cachedConversations().map((c) => c.id).sort()).toEqual(['c1', 'h1']);
  });

  it('forgets everything on sign-out', async () => {
    const store = new Map<string, string>();
    const first = await load(store);
    first.rememberThread(conversation('c1'), [message('m1')]);
    vi.advanceTimersByTime(500);
    first.clearThreadCache();

    const second = await load(store);
    expect(second.cachedThread('c1')).toBeNull();
  });
});
