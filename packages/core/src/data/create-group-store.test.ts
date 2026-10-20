import { describe, expect, it, vi } from 'vitest';
import { observable } from '@legendapp/state';
import { reconcileDeletedRows, type GroupRecord, type SyncedRow } from './create-group-store';

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
