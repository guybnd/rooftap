// @vitest-environment jsdom

// HOUP-327: drives the real useChecklistToggle hook (renderHook), mocking
// only the store plumbing (./stores + useStoreHelpers) so setItemsDone/
// syncAfterClear's actual patch/write/soft-delete/sync side effects run
// exactly as a screen would trigger them.

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Checklist, ChecklistTaskItem } from '../../types';
import { ALL_MODULE_IDS, type ModuleId } from '../../modules';
import { resetModulesStore, setAvailableModules } from '../../modules-store';

const patchItem = vi.fn();
const writeCost = vi.fn();
const softDeleteCost = vi.fn();
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
        return { writeRow: vi.fn(), patchRow: patchItem, softDeleteRow: vi.fn() };
      case 'checklists':
        return { writeRow: vi.fn(), patchRow: patchList, softDeleteRow: vi.fn() };
      case 'householdTasks':
        return { writeRow: vi.fn(), patchRow: patchTask, softDeleteRow: vi.fn() };
      case 'costItems':
        return { writeRow: writeCost, patchRow: vi.fn(), softDeleteRow: softDeleteCost };
      default:
        throw new Error(`unexpected store tag ${store$.__tag}`);
    }
  },
}));

// eslint-disable-next-line import/first
import { useChecklistToggle } from './use-checklist-toggle';

function makeChecklist(overrides: Partial<Checklist> = {}): Checklist {
  return {
    id: 'list-1',
    group_id: 'group-1',
    title: 'Groceries',
    type: 'shopping',
    template_key: null,
    source_checklist_id: null,
    completed_at: null,
    scheduled_date: null,
    linked_task_id: 'task-1',
    log_costs: true,
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
    cost_cents: 300,
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
  patchItem.mockClear();
  writeCost.mockClear();
  softDeleteCost.mockClear();
  patchList.mockClear();
  patchTask.mockClear();
});

afterEach(() => {
  resetModulesStore();
});

describe('setItemsDone', () => {
  it('Check all on every-open items patches each, logs one cost each, and fires exactly one linked-task patch', () => {
    const checklist = makeChecklist();
    const items = [
      makeItem({ id: 'a', order: 0 }),
      makeItem({ id: 'b', order: 1 }),
      makeItem({ id: 'c', order: 2 }),
    ];
    const { result } = renderHook(() => useChecklistToggle(checklist, items, 'user-1'));

    result.current.setItemsDone(items, true);

    expect(patchItem).toHaveBeenCalledTimes(3 + 3); // check patch + linked_cost_item_id patch, per item
    expect(writeCost).toHaveBeenCalledTimes(3);
    expect(patchTask).toHaveBeenCalledTimes(1);
    expect(patchTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ done: true }));
    expect(patchList).toHaveBeenCalledTimes(1);
    expect(patchList).toHaveBeenCalledWith('list-1', expect.objectContaining({ completed_at: expect.any(String) }));
  });

  it('on a mixed list, Check all targeting only the open rows leaves the already-done row untouched and still fires one linked-task patch', () => {
    const checklist = makeChecklist();
    const alreadyDone = makeItem({ id: 'done-1', order: 0, is_done: true, checked_at: '2026-01-01T00:00:00.000Z', cost_cents: null });
    const open1 = makeItem({ id: 'open-1', order: 1 });
    const open2 = makeItem({ id: 'open-2', order: 2 });
    const items = [alreadyDone, open1, open2];
    const { result } = renderHook(() => useChecklistToggle(checklist, items, 'user-1'));

    result.current.setItemsDone([open1, open2], true);

    // patchItem only ever touched the two open rows (check patch + cost-link patch each) — never done-1.
    const touchedIds = new Set(patchItem.mock.calls.map(([id]) => id));
    expect(touchedIds).toEqual(new Set(['open-1', 'open-2']));
    expect(patchTask).toHaveBeenCalledTimes(1);
    expect(patchTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ done: true }));
  });

  it('Uncheck all soft-deletes each linked cost and clears the link, once per targeted item', () => {
    const checklist = makeChecklist({ completed_at: '2026-01-02T00:00:00.000Z' });
    const items = [
      makeItem({ id: 'a', is_done: true, linked_cost_item_id: 'cost-a' }),
      makeItem({ id: 'b', is_done: true, linked_cost_item_id: 'cost-b' }),
    ];
    const { result } = renderHook(() => useChecklistToggle(checklist, items, 'user-1'));

    result.current.setItemsDone(items, false);

    expect(softDeleteCost).toHaveBeenCalledTimes(2);
    expect(softDeleteCost).toHaveBeenCalledWith('cost-a');
    expect(softDeleteCost).toHaveBeenCalledWith('cost-b');
    // uncheck patch + linked_cost_item_id:null patch, per item
    expect(patchItem).toHaveBeenCalledTimes(4);
    // no longer complete -> the linked list/task un-archive fires
    expect(patchTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ done: false }));
    expect(patchList).toHaveBeenCalledWith('list-1', expect.objectContaining({ completed_at: null }));
  });

  it('un-archives from the stored list when the caller holds a copy from before it completed', () => {
    // An Undo tap from a toast whose surface unmounted: its checklist copy
    // predates the archive the last tick wrote.
    const stale = makeChecklist({ completed_at: null });
    storedLists = { 'list-1': makeChecklist({ completed_at: '2026-01-02T00:00:00.000Z' }) };
    const item = makeItem({ id: 'a', is_done: true, cost_cents: null });
    const { result } = renderHook(() => useChecklistToggle(stale, [item], 'user-1'));

    result.current.setItemsDone([item], false);

    expect(patchList).toHaveBeenCalledWith('list-1', expect.objectContaining({ completed_at: null }));
  });

  it('is a no-op with an empty target list', () => {
    const checklist = makeChecklist();
    const { result } = renderHook(() => useChecklistToggle(checklist, [], 'user-1'));

    result.current.setItemsDone([], true);

    expect(patchItem).not.toHaveBeenCalled();
    expect(patchTask).not.toHaveBeenCalled();
  });
});

describe('syncAfterClear', () => {
  it('is a no-op when the remaining projection is empty (D8: an emptied list keeps its completion)', () => {
    const checklist = makeChecklist({ completed_at: '2026-01-02T00:00:00.000Z' });
    const { result } = renderHook(() => useChecklistToggle(checklist, [], 'user-1'));

    result.current.syncAfterClear([]);

    expect(patchTask).not.toHaveBeenCalled();
    expect(patchList).not.toHaveBeenCalled();
  });

  it('syncs normally against a non-empty remaining projection', () => {
    const checklist = makeChecklist();
    const remaining = [makeItem({ id: 'a', is_done: false })];
    const { result } = renderHook(() => useChecklistToggle(checklist, remaining, 'user-1'));

    result.current.syncAfterClear(remaining);

    expect(patchTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ done: false }));
  });

  it('reached from both Clear completed and deleteItem on a one-item list, produces the same (no-op) outcome', () => {
    const checklist = makeChecklist({ completed_at: '2026-01-02T00:00:00.000Z' });
    const { result: clearResult } = renderHook(() => useChecklistToggle(checklist, [], 'user-1'));
    const { result: deleteResult } = renderHook(() => useChecklistToggle(checklist, [], 'user-1'));

    clearResult.current.syncAfterClear([]); // Clear completed's remaining projection
    deleteResult.current.syncAfterClear([]); // deleteItem's remaining projection

    expect(patchTask).not.toHaveBeenCalled();
    expect(patchList).not.toHaveBeenCalled();
  });
});

describe('toggleItem', () => {
  it('delegates to setItemsDone([item], !item.is_done)', () => {
    const checklist = makeChecklist();
    const item = makeItem({ id: 'a', is_done: false });
    const { result } = renderHook(() => useChecklistToggle(checklist, [item], 'user-1'));

    result.current.toggleItem(item);

    expect(patchItem).toHaveBeenCalledWith('a', expect.objectContaining({ is_done: true }));
    expect(writeCost).toHaveBeenCalledTimes(1);
  });
});

// Modules (.docs/modules.md): with Costs off, checking an item logs no new
// cost line. Rows the list already created stay in sync whatever is off: the
// linked to-do follows the list, and unchecking removes the item's cost line,
// so both are right when their module comes back.
describe('module gates', () => {
  const cases: { off: ModuleId | null; logsCost: boolean }[] = [
    { off: null, logsCost: true },
    { off: 'household', logsCost: true },
    { off: 'costs', logsCost: false },
    { off: 'checklists', logsCost: false },
    { off: 'groceries', logsCost: true },
    { off: 'calendar', logsCost: true },
  ];

  const withOff = (off: ModuleId | null) => setAvailableModules(ALL_MODULE_IDS.filter((m) => m !== off));

  it.each(cases)('checking with $off off: new cost logged $logsCost, linked task synced', ({ off, logsCost }) => {
    withOff(off);
    const checklist = makeChecklist();
    const items = [makeItem({ id: 'a' })];
    const { result } = renderHook(() => useChecklistToggle(checklist, items, 'user-1'));

    result.current.setItemsDone(items, true);

    expect(patchItem).toHaveBeenCalledWith('a', expect.objectContaining({ is_done: true }));
    expect(writeCost).toHaveBeenCalledTimes(logsCost ? 1 : 0);
    expect(patchItem).toHaveBeenCalledTimes(logsCost ? 2 : 1);
    expect(patchTask).toHaveBeenCalledTimes(1);
    expect(patchList).toHaveBeenCalledWith('list-1', expect.objectContaining({ completed_at: expect.any(String) }));
  });

  it.each(cases)('unchecking with $off off: logged cost removed, linked task synced', ({ off }) => {
    withOff(off);
    const checklist = makeChecklist({ completed_at: '2026-01-02T00:00:00.000Z' });
    const items = [makeItem({ id: 'a', is_done: true, linked_cost_item_id: 'cost-a' })];
    const { result } = renderHook(() => useChecklistToggle(checklist, items, 'user-1'));

    result.current.setItemsDone(items, false);

    expect(softDeleteCost).toHaveBeenCalledWith('cost-a');
    expect(patchItem).toHaveBeenCalledWith('a', { linked_cost_item_id: null });
    expect(patchTask).toHaveBeenCalledTimes(1);
    expect(patchList).toHaveBeenCalledWith('list-1', expect.objectContaining({ completed_at: null }));
  });
});
