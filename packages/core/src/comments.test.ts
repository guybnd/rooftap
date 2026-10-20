import { describe, expect, it, vi } from 'vitest';
import {
  listEntityComments,
  postEntityComment,
  deleteEntityComment,
  countEntityCommentsBulk,
  type EntityCommentsTarget,
} from './comments';

type QueryResult = { data: unknown; error: unknown };

function makeQueryBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => Promise.resolve(result)),
    order: vi.fn(() => Promise.resolve(result)),
    insert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

function makeFakeSupabase(result: QueryResult) {
  const from = vi.fn(() => makeQueryBuilder(result));
  return { from, __from: from };
}

const target: EntityCommentsTarget = {
  table: 'household_task_comments',
  fkColumn: 'household_task_id',
  entityId: 'task-1',
};

describe('listEntityComments', () => {
  it('scopes the query to the target table/fk/entity and returns rows', async () => {
    const rows = [{ id: 'c1', user_id: 'u1', content: 'hi', created_at: '2026-01-01T00:00:00Z' }];
    const supabase = makeFakeSupabase({ data: rows, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listEntityComments(supabase as any, target);
    expect(result).toEqual(rows);
    expect(supabase.__from).toHaveBeenCalledWith('household_task_comments');
  });

  it('returns an empty array when the query yields no data', async () => {
    const supabase = makeFakeSupabase({ data: null, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listEntityComments(supabase as any, target);
    expect(result).toEqual([]);
  });
});

describe('postEntityComment', () => {
  it('inserts with the fk column set to the entity id and returns the saved row', async () => {
    const saved = { id: 'c2', user_id: 'u1', content: 'new comment', created_at: '2026-01-02T00:00:00Z' };
    const supabase = makeFakeSupabase({ data: saved, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await postEntityComment(supabase as any, target, 'u1', 'new comment');
    expect(result).toEqual(saved);
    const builder = supabase.__from.mock.results[0].value;
    expect(builder.insert).toHaveBeenCalledWith({
      household_task_id: 'task-1',
      user_id: 'u1',
      content: 'new comment',
    });
  });

  it('throws when the insert fails', async () => {
    const supabase = makeFakeSupabase({ data: null, error: new Error('insert failed') });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      postEntityComment(supabase as any, target, 'u1', 'new comment')
    ).rejects.toThrow('insert failed');
  });
});

describe('countEntityCommentsBulk', () => {
  it('tallies rows client-side into a per-entity count map', async () => {
    const rows = [
      { household_task_id: 'task-1' },
      { household_task_id: 'task-1' },
      { household_task_id: 'task-2' },
    ];
    const supabase = makeFakeSupabase({ data: rows, error: null });
    const result = await countEntityCommentsBulk(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'household_task_comments',
      'household_task_id',
      ['task-1', 'task-2', 'task-3']
    );
    expect(result).toEqual({ 'task-1': 2, 'task-2': 1 });
    expect(supabase.__from).toHaveBeenCalledWith('household_task_comments');
    const builder = supabase.__from.mock.results[0].value;
    expect(builder.in).toHaveBeenCalledWith('household_task_id', ['task-1', 'task-2', 'task-3']);
  });

  it('omits entities with zero comments from the result (not a 0 entry)', async () => {
    const supabase = makeFakeSupabase({ data: [{ household_task_id: 'task-1' }], error: null });
    const result = await countEntityCommentsBulk(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'household_task_comments',
      'household_task_id',
      ['task-1', 'task-2']
    );
    expect(result).toEqual({ 'task-1': 1 });
    expect('task-2' in result).toBe(false);
  });

  it('returns an empty map without querying when entityIds is empty', async () => {
    const supabase = makeFakeSupabase({ data: null, error: null });
    const result = await countEntityCommentsBulk(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'household_task_comments',
      'household_task_id',
      []
    );
    expect(result).toEqual({});
    expect(supabase.__from).not.toHaveBeenCalled();
  });
});

describe('deleteEntityComment', () => {
  it('deletes by id on the given table', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    builder.eq = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const supabase = { from: vi.fn(() => builder) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await deleteEntityComment(supabase as any, 'household_task_comments', 'c1');
    expect(supabase.from).toHaveBeenCalledWith('household_task_comments');
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', 'c1');
  });

  it('throws when the delete fails', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    builder.eq = vi.fn(() => Promise.resolve({ data: null, error: new Error('delete failed') }));
    const supabase = { from: vi.fn(() => builder) };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deleteEntityComment(supabase as any, 'household_task_comments', 'c1')
    ).rejects.toThrow('delete failed');
  });
});
