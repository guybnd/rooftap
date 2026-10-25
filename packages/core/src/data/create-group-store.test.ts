import { describe, expect, it, vi } from 'vitest';
import { observable } from '@legendapp/state';
import {
  MAX_SERVER_ERROR_ATTEMPTS,
  reconcileDeletedRows,
  writeErrorAction,
  type GroupRecord,
  type SyncedRow,
} from './create-group-store';

interface Row extends SyncedRow {
  title: string;
}

function makeSupabaseMock(deletedIds: string[]) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve({ data: deletedIds.map((id) => ({ id })), error: null }).then(resolve, reject),
  };
  return { from: vi.fn(() => builder) };
}

// HOUP-243: a delete missed while the realtime channel is briefly down gets
// stranded once ANY later row on the same collection is delivered — that
// event advances the shared `lastSync` watermark past the missed row's
// `updated_at`, and the fallback delta pull's `.gt(updated_at, lastSync)`
// then skips it forever. reconcileDeletedRows must remove a locally-cached
// row the server reports deleted WITHOUT consulting lastSync at all, so it
// converges regardless of where the watermark has drifted to.
describe('reconcileDeletedRows', () => {
  it('removes a locally-cached row the server reports as deleted, independent of any watermark', async () => {
    const store$ = observable<GroupRecord<Row>>({
      'task-a': { id: 'task-a', group_id: 'group-1', deleted: false, title: 'Buy milk' },
      'task-b': { id: 'task-b', group_id: 'group-1', deleted: false, title: 'Take out trash' },
    });
    const supabase = makeSupabaseMock(['task-a']);

    await reconcileDeletedRows({ supabase } as never, 'household_tasks', 'group-1', store$);

    expect(store$.peek()).toEqual({
      'task-b': { id: 'task-b', group_id: 'group-1', deleted: false, title: 'Take out trash' },
    });
  });

  it('is a no-op when the server reports no deleted rows for the group', async () => {
    const store$ = observable<GroupRecord<Row>>({
      'task-a': { id: 'task-a', group_id: 'group-1', deleted: false, title: 'Buy milk' },
    });
    const supabase = makeSupabaseMock([]);

    await reconcileDeletedRows({ supabase } as never, 'household_tasks', 'group-1', store$);

    expect(store$.peek()).toEqual({
      'task-a': { id: 'task-a', group_id: 'group-1', deleted: false, title: 'Buy milk' },
    });
  });

  it('ignores a deleted id the group has no local copy of', async () => {
    const store$ = observable<GroupRecord<Row>>({
      'task-a': { id: 'task-a', group_id: 'group-1', deleted: false, title: 'Buy milk' },
    });
    const supabase = makeSupabaseMock(['task-never-seen-locally']);

    await reconcileDeletedRows({ supabase } as never, 'household_tasks', 'group-1', store$);

    expect(store$.peek()).toEqual({
      'task-a': { id: 'task-a', group_id: 'group-1', deleted: false, title: 'Buy milk' },
    });
  });

  it('swallows query failures so a transient error never throws — the 24h reset pull remains the backstop', async () => {
    const store$ = observable<GroupRecord<Row>>({
      'task-a': { id: 'task-a', group_id: 'group-1', deleted: false, title: 'Buy milk' },
    });
    const supabase = { from: vi.fn(() => { throw new Error('network down'); }) };

    await expect(
      reconcileDeletedRows({ supabase } as never, 'household_tasks', 'group-1', store$),
    ).resolves.toBeUndefined();
    expect(store$.peek()).toEqual({
      'task-a': { id: 'task-a', group_id: 'group-1', deleted: false, title: 'Buy milk' },
    });
  });
});

// Stuck-sync fix: a write the server keeps refusing must not hold the outbox
// (and the "Syncing 1 pending change" banner) forever.
describe('writeErrorAction', () => {
  const online = { online: true, attempts: 1 };

  it('drops a permanent error at once', () => {
    expect(writeErrorAction({ message: 'violates row-level security', code: '42501' }, 403, online)).toBe('drop');
  });

  it('keeps retrying a request that got no answer, however many times it failed', () => {
    const error = { message: 'TypeError: Failed to fetch' };
    expect(writeErrorAction(error, 0, { online: true, attempts: 500 })).toBe('retry');
    expect(writeErrorAction(error, undefined, { online: true, attempts: 500 })).toBe('retry');
  });

  it('keeps retrying while offline', () => {
    expect(writeErrorAction({ message: 'server error' }, 503, { online: false, attempts: 500 })).toBe('retry');
  });

  it('retries a server error a few times, then drops it', () => {
    const error = { message: 'canceling statement due to statement timeout', code: '57014' };
    expect(writeErrorAction(error, 500, { online: true, attempts: MAX_SERVER_ERROR_ATTEMPTS - 1 })).toBe('retry');
    expect(writeErrorAction(error, 500, { online: true, attempts: MAX_SERVER_ERROR_ATTEMPTS })).toBe('drop');
    expect(writeErrorAction({ message: 'JWT expired', code: 'PGRST301' }, 401, { online: true, attempts: MAX_SERVER_ERROR_ATTEMPTS })).toBe('drop');
  });
});
