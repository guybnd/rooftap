import { describe, expect, it, vi } from 'vitest';
import { archiveConversation, canArchiveConversation, changeWithUndo, deleteConversation, onConversationsChanged, overrideScoutRun, scoutRunLists, type UndoToast } from './archive-undo';
import type { AssistantConversation } from './modules/assistant/assistant-api';
import type { ShopperSearch } from './modules/shopper/shopper-scout';

function fakeToast() {
  const undos: (() => void)[] = [];
  const toast: UndoToast & { lines: string[] } = {
    lines: [],
    undo: (m, fn) => {
      toast.lines.push(m);
      undos.push(fn);
    },
    message: (m) => toast.lines.push(m),
    error: (m) => toast.lines.push(`error: ${m}`),
  };
  return { toast, undos };
}

const chat = { id: 'c1', kind: 'chat', title: 'Tacos', pinned: false, last_active_at: '', closes_at: null, pending: 0 } as AssistantConversation;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('archive and delete with Undo', () => {
  it('archives a chat, tells the lists, and undoes it', async () => {
    const api = { updateConversation: vi.fn(async () => ({ ok: true as const })) };
    const { toast, undos } = fakeToast();
    const changed = vi.fn();
    const off = onConversationsChanged(changed);
    expect(await archiveConversation(api, chat, toast)).toBe(true);
    expect(api.updateConversation).toHaveBeenLastCalledWith('c1', { archived: true });
    expect(toast.lines).toEqual(['Chat archived.']);
    undos[0]();
    await flush();
    expect(api.updateConversation).toHaveBeenLastCalledWith('c1', { archived: false });
    expect(changed).toHaveBeenCalledTimes(2);
    off();
  });

  it('takes a delete back with deleted: false', async () => {
    const api = { updateConversation: vi.fn(async () => ({ ok: true as const })) };
    const { toast, undos } = fakeToast();
    await deleteConversation(api, chat, toast);
    undos[0]();
    await flush();
    expect(api.updateConversation.mock.calls.map((c) => (c as unknown[])[1])).toEqual([{ deleted: true }, { deleted: false }]);
  });

  it('says why a change failed and offers no Undo', async () => {
    const { toast, undos } = fakeToast();
    const ok = await changeWithUndo(toast, {
      run: async () => {
        throw new Error('Offline');
      },
      undo: async () => {},
      message: 'Done.',
      failed: 'Could not.',
    });
    expect(ok).toBe(false);
    expect(toast.lines).toEqual(['error: Offline']);
    expect(undos).toHaveLength(0);
  });

  it('never archives the Household thread', () => {
    expect(canArchiveConversation({ kind: 'household' })).toBe(false);
    expect(canArchiveConversation({ kind: 'quick' })).toBe(true);
    expect(canArchiveConversation(null)).toBe(false);
  });
});

const run = (id: string, over: Partial<ShopperSearch> = {}): ShopperSearch =>
  ({ id, created_at: `2026-10-22T0${id.length}:00:00Z`, deleted: false, archived_at: null, thread_id: null, ...over }) as ShopperSearch;

describe('scoutRunLists', () => {
  it('splits first runs into shown and archived, newest first', () => {
    const lists = scoutRunLists([run('a'), run('bb', { archived_at: '2026-10-22T09:00:00Z' }), run('ccc'), run('r', { thread_id: 'a' }), run('dddd', { deleted: true }), null]);
    expect(lists.recent.map((r) => r.id)).toEqual(['ccc', 'a']);
    expect(lists.archived.map((r) => r.id)).toEqual(['bb']);
  });

  it('shows a change made here before sync brings it, then lets the row speak', () => {
    overrideScoutRun('x1', { archived: true });
    expect(scoutRunLists([run('x1')]).archived.map((r) => r.id)).toEqual(['x1']);
    // Sync caught up: the override drops, and a later change from someone else shows.
    expect(scoutRunLists([run('x1', { archived_at: '2026-10-22T09:00:00Z' })]).archived).toHaveLength(1);
    expect(scoutRunLists([run('x1')]).recent.map((r) => r.id)).toEqual(['x1']);
    overrideScoutRun('x2', { deleted: true });
    expect(scoutRunLists([run('x2')]).recent).toHaveLength(0);
  });
});
