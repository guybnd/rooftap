import { describe, expect, it } from 'vitest';
import type { GrocerySession } from '@homeup/core';
import { invalidateSessionFetch, isFreshSessionFetch, startSessionFetch } from './session-fetch-freshness';

function makeSession(id: string, summedTotalCents = 0): GrocerySession {
  return {
    id,
    group_id: 'group-a',
    session_date: '2026-08-03',
    summed_total_cents: summedTotalCents,
    override_total_cents: null,
    receipt_total_cents: null,
    retailer: null,
    receipt_path: null,
    receipt_name: null,
    tracking: 'on',
    cost_item_id: null,
    closed_at: null,
    created_by: null,
    created_at: '2026-08-03T00:00:00.000Z',
    updated_at: '2026-08-03T00:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('session fetch freshness guard', () => {
  it('keeps a realtime current-day session when the initial fetch resolves stale null afterward', async () => {
    const versionRef = { current: 0 };
    let session: GrocerySession | null = null;
    const fetch = deferred<GrocerySession | null>();
    const fetchVersion = startSessionFetch(versionRef);
    const applyFetch = fetch.promise.then((next) => {
      if (isFreshSessionFetch(versionRef, fetchVersion)) session = next;
    });

    const realtimeSession = makeSession('session-from-realtime', 1200);
    invalidateSessionFetch(versionRef);
    session = realtimeSession;

    fetch.resolve(null);
    await applyFetch;

    expect(session).toBe(realtimeSession);
  });

  it('keeps a realtime delete when the initial fetch resolves with a stale session afterward', async () => {
    const versionRef = { current: 0 };
    const staleSession = makeSession('deleted-session', 900);
    let session: GrocerySession | null = staleSession;
    const fetch = deferred<GrocerySession | null>();
    const fetchVersion = startSessionFetch(versionRef);
    const applyFetch = fetch.promise.then((next) => {
      if (isFreshSessionFetch(versionRef, fetchVersion)) session = next;
    });

    invalidateSessionFetch(versionRef);
    session = null;

    fetch.resolve(staleSession);
    await applyFetch;

    expect(session).toBeNull();
  });
});
