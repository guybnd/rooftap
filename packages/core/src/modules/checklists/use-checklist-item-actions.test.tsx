// @vitest-environment jsdom

// HOUP-332: drives the real useChecklistItemActions hook (renderHook), mocking
// only the store plumbing (./stores + useStoreHelpers) — same proven pattern as
// use-checklist-toggle.test.tsx. Covers the behavior the plan's review rounds
// called out by name: add syncs (the pre-existing bug this hook fixes),
// restoreItems batches into one sync, and the freshness contract (a closure
// captured before a re-render still writes the correct value against fresh
// state, not its stale render-time capture).

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Checklist, ChecklistTaskItem } from '../../types';

const writeItem = vi.fn();
const patchItem = vi.fn();
const softDeleteItem = vi.fn();
const patchList = vi.fn();
const patchTask = vi.fn();
// What the stores hold right now (`peek()`), for reads that must not trust a render's copy.
let storedLists: Record<string, Checklist> = {};
let storedItems: Record<string, ChecklistTaskItem> = {};

vi.mock('../../data/stores', () => ({
  checklists$: () => ({ __tag: 'checklists', peek: () => storedLists }),
  checklistItems$: () => ({ __tag: 'checklistItems', peek: () => storedItems }),
  householdTasks$: () => ({ __tag: 'householdTasks' }),
  costItems$: () => ({ __tag: 'costItems' }),
}));

vi.mock('../../data/create-group-store', () => ({
  useStoreHelpers: (store$: { __tag: string }) => {
    switch (store$.__tag) {
      case 'checklistItems':
        return { writeRow: writeItem, patchRow: patchItem, softDeleteRow: softDeleteItem };
      case 'checklists':
        return { writeRow: vi.fn(), patchRow: patchList, softDeleteRow: vi.fn() };
      case 'householdTasks':
        return { writeRow: vi.fn(), patchRow: patchTask, softDeleteRow: vi.fn() };
      case 'costItems':
        return { writeRow: vi.fn(), patchRow: vi.fn(), softDeleteRow: vi.fn() };
      default:
        throw new Error(`unexpected store tag ${store$.__tag}`);
    }
  },
}));

// eslint-disable-next-line import/first
import { useChecklistItemActions } from './use-checklist-item-actions';

function makeChecklist(overrides: Partial<Checklist> = {}): Checklist {
  return {
    id: 'list-1',
    group_id: 'group-1',
    title: 'Groceries',
    type: 'plain',
    template_key: null,
    source_checklist_id: null,
    completed_at: null,
    scheduled_date: null,
    linked_task_id: 'task-1',
    log_costs: false,
    repeat_cadence_days: null,
    repeat_renewal_mode: null,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

function makeItem(overrides: Partial<ChecklistTaskItem>): ChecklistTaskItem {
  return {
    id: 'item',
    checklist_id: 'list-1',
    group_id: 'group-1',
    label: 'Milk',
    is_done: false,
    checked_by: null,
    checked_at: null,
    cost_cents: null,
    linked_cost_item_id: null,
    order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

beforeEach(() => {
  storedLists = {};
  storedItems = {};
  writeItem.mockClear();
  patchItem.mockClear();
  softDeleteItem.mockClear();
  patchList.mockClear();
  patchTask.mockClear();
});

describe('addItems', () => {
  it('appends the labels and syncs completion over the projected list (the pre-existing "add never syncs" bug)', () => {
    const checklist = makeChecklist();
    const items = [makeItem({ id: 'a', is_done: true })];
    const { result } = renderHook(() => useChecklistItemActions(checklist, items, 'user-1'));

    let created: ChecklistTaskItem[] = [];
    act(() => {
      created = result.current.addItems(['Eggs']);
    });

    expect(writeItem).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(created[0].label).toBe('Eggs');
    // Adding an unchecked item to a fully-checked list un-completes the linked to-do.
    expect(patchTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ done: false, completed_at: null }));
  });

  it('re-opens a done linked task and clears completed_at on a completed non-repeating list', () => {
    const checklist = makeChecklist({ completed_at: '2026-01-02T00:00:00.000Z' });
    const items = [makeItem({ id: 'a', is_done: true })];
    const { result } = renderHook(() => useChecklistItemActions(checklist, items, 'user-1'));

    act(() => {
      result.current.addItems(['Eggs']);
    });

    expect(patchTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ done: false, completed_at: null }));
    expect(patchList).toHaveBeenCalledWith('list-1', expect.objectContaining({ completed_at: null }));
  });

  it('is a no-op when every label is blank', () => {
    const checklist = makeChecklist();
    const { result } = renderHook(() => useChecklistItemActions(checklist, [], 'user-1'));

    let created: ChecklistTaskItem[] = [];
    act(() => {
      created = result.current.addItems(['   ', '']);
    });

    expect(created).toEqual([]);
    expect(writeItem).not.toHaveBeenCalled();
    expect(patchTask).not.toHaveBeenCalled();
  });
});

describe('deleteItem', () => {
  it('soft-deletes and, when it was the last open item, ticks the linked to-do (routes through the D8 empty-list guard)', () => {
    const checklist = makeChecklist();
    const item = makeItem({ id: 'a', is_done: false });
    const { result } = renderHook(() => useChecklistItemActions(checklist, [item], 'user-1'));

    act(() => {
      result.current.deleteItem(item);
    });

    expect(softDeleteItem).toHaveBeenCalledWith('a');
    // D8: deleting the ONLY remaining item leaves an empty projection — the
    // guard skips the sync rather than un-ticking the linked to-do.
    expect(patchTask).not.toHaveBeenCalled();
  });

  it('syncs against the remaining projection when other items are left', () => {
    const checklist = makeChecklist();
    const a = makeItem({ id: 'a', is_done: false });
    const b = makeItem({ id: 'b', is_done: true });
    const { result } = renderHook(() => useChecklistItemActions(checklist, [a, b], 'user-1'));

    act(() => {
      result.current.deleteItem(a);
    });

    // Remaining projection is [b] (done) -> the list completes.
    expect(patchTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ done: true }));
  });
});

describe('uncheckItems', () => {
  it('unchecks the stored rows, so a Shopping tick undone after unmount still drops its logged cost', () => {
    // The hook's copy predates the tick; the store has the tick and its cost link.
    const before = makeItem({ id: 'a', is_done: false });
    storedItems = {
      a: makeItem({ id: 'a', is_done: true, checked_at: '2026-10-19T09:00:00.000Z', linked_cost_item_id: 'cost-a' }),
      b: makeItem({ id: 'b', is_done: false }),
    };
    const { result } = renderHook(() => useChecklistItemActions(makeChecklist(), [before], 'user-1'));

    act(() => {
      result.current.uncheckItems(['a', 'b', 'gone']);
    });

    // Only `a` is still checked: its uncheck patch plus clearing the cost link.
    expect(new Set(patchItem.mock.calls.map(([id]) => id))).toEqual(new Set(['a']));
    expect(patchItem).toHaveBeenCalledWith('a', { linked_cost_item_id: null });
    expect(patchTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ done: false }));
  });

  it('is a no-op when nothing is still checked', () => {
    storedItems = { a: makeItem({ id: 'a', is_done: false }) };
    const { result } = renderHook(() => useChecklistItemActions(makeChecklist(), [], 'user-1'));

    act(() => {
      result.current.uncheckItems(['a']);
    });

    expect(patchItem).not.toHaveBeenCalled();
    expect(patchTask).not.toHaveBeenCalled();
  });
});

describe('restoreItems', () => {
  it('restores a two-item batch in one patch pass and fires exactly ONE completion sync', () => {
    const checklist = makeChecklist();
    const remaining = [makeItem({ id: 'c', is_done: true })];
    const { result } = renderHook(() => useChecklistItemActions(checklist, remaining, 'user-1'));

    const restored = [
      makeItem({ id: 'a', is_done: true, deleted: true }),
      makeItem({ id: 'b', is_done: true, deleted: true }),
    ];

    act(() => {
      result.current.restoreItems(restored);
    });

    expect(patchItem).toHaveBeenCalledTimes(2);
    expect(patchItem).toHaveBeenCalledWith('a', { deleted: false });
    expect(patchItem).toHaveBeenCalledWith('b', { deleted: false });
    // One sync over the full restored projection (c + a + b, all done) -> complete.
    expect(patchTask).toHaveBeenCalledTimes(1);
    expect(patchTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ done: true }));
  });

  it('is a no-op with an empty batch', () => {
    const checklist = makeChecklist();
    const { result } = renderHook(() => useChecklistItemActions(checklist, [], 'user-1'));

    act(() => {
      result.current.restoreItems([]);
    });

    expect(patchItem).not.toHaveBeenCalled();
    expect(patchTask).not.toHaveBeenCalled();
  });

  it('freshness contract: a restoreItems closure captured before a re-render writes against CURRENT items, not its stale render-time capture', () => {
    const checklist = makeChecklist();
    const a = makeItem({ id: 'a', is_done: false }); // open — would make any projection containing it incomplete.
    const { result, rerender } = renderHook(
      ({ items }: { items: ChecklistTaskItem[] }) => useChecklistItemActions(checklist, items, 'user-1'),
      { initialProps: { items: [a] } },
    );

    // Capture the closure from THIS render, while `items` still contains the open `a`.
    const capturedRestoreItems = result.current.restoreItems;

    // `a` gets removed elsewhere (e.g. soft-deleted) and the hook re-renders
    // with an empty live set — mirrors items changing between when an Undo
    // toast is armed and when it's actually tapped.
    rerender({ items: [] });

    const restored = [makeItem({ id: 'c', is_done: true, deleted: true })];
    act(() => {
      capturedRestoreItems(restored);
    });

    // Stale capture (`items: [a]`, open) would project [a(open), c(done)] ->
    // incomplete. Reading fresh state (`items: []` at call time) projects
    // [c(done)] only -> complete. These diverge, so this assertion fails loudly
    // if the ref-based freshness regresses back to a plain closure capture.
    expect(patchTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ done: true }));
  });
});

describe('renameItem / repriceItem', () => {
  it('renameItem patches the trimmed label and never touches is_done', () => {
    const checklist = makeChecklist();
    const item = makeItem({ id: 'a' });
    const { result } = renderHook(() => useChecklistItemActions(checklist, [item], 'user-1'));

    act(() => {
      result.current.renameItem(item, '  Bread  ');
    });

    expect(patchItem).toHaveBeenCalledWith('a', { label: 'Bread' });
    expect(patchTask).not.toHaveBeenCalled();
  });

  it('renameItem is a no-op (revert) on an empty submit', () => {
    const checklist = makeChecklist();
    const item = makeItem({ id: 'a' });
    const { result } = renderHook(() => useChecklistItemActions(checklist, [item], 'user-1'));

    act(() => {
      result.current.renameItem(item, '   ');
    });

    expect(patchItem).not.toHaveBeenCalled();
  });

  it('repriceItem patches cost_cents from a dollars string and never syncs', () => {
    const checklist = makeChecklist({ type: 'shopping' });
    const item = makeItem({ id: 'a' });
    const { result } = renderHook(() => useChecklistItemActions(checklist, [item], 'user-1'));

    act(() => {
      result.current.repriceItem(item, '4.50');
    });

    expect(patchItem).toHaveBeenCalledWith('a', { cost_cents: 450 });
    expect(patchTask).not.toHaveBeenCalled();
  });
});
