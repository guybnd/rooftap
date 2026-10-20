import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchProfileLabels, inviteToGroup } from './group-admin';

function fakeSupabase(rpcData: unknown, insertError: unknown = null) {
  const insert = vi.fn(() => Promise.resolve({ error: insertError }));
  const client = {
    rpc: vi.fn(() => Promise.resolve({ data: rpcData, error: null })),
    from: vi.fn(() => ({ insert })),
  };
  return { client: client as unknown as SupabaseClient, insert };
}

const base = { groupId: 'g1', invitedBy: 'me', email: 'a@b.c', memberIds: ['m1'], invitedIds: ['i1'] };

describe('inviteToGroup', () => {
  it('reports an unknown email without writing', async () => {
    const { client, insert } = fakeSupabase(null);
    expect(await inviteToGroup(client, base)).toBe('not_found');
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses existing members and already-invited users', async () => {
    expect(await inviteToGroup(fakeSupabase('m1').client, base)).toBe('already_member');
    expect(await inviteToGroup(fakeSupabase('i1').client, base)).toBe('already_invited');
  });

  it('records the invitation for a new user', async () => {
    const { client, insert } = fakeSupabase('u9');
    expect(await inviteToGroup(client, base)).toBe('sent');
    expect(insert).toHaveBeenCalledWith({ group_id: 'g1', invited_by: 'me', invited_user_id: 'u9' });
  });

  it('reports a failed insert', async () => {
    expect(await inviteToGroup(fakeSupabase('u9', { message: 'rls' }).client, base)).toBe('failed');
  });
});

describe('fetchProfileLabels', () => {
  it('prefers display name, then email, then a short id', async () => {
    const { client } = fakeSupabase([
      { id: 'u1', display_name: 'Guy', email: 'g@x' },
      { id: 'u2', display_name: '', email: 'e@x' },
      { id: 'abcdefghij', display_name: '', email: '' },
    ]);
    expect(await fetchProfileLabels(client, ['u1', 'u2', 'abcdefghij'])).toEqual({
      u1: 'Guy',
      u2: 'e@x',
      abcdefghij: 'abcdefgh',
    });
  });
});
