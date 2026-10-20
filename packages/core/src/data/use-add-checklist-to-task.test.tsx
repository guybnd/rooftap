// @vitest-environment jsdom

// HOUP-332: drives the real useAddChecklistToTask hook (renderHook), mocking
// only the store plumbing — same proven pattern as use-checklist-toggle.test.tsx.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HouseholdTask } from '../types';

const writeChecklist = vi.fn();
const softDeleteChecklist = vi.fn();
const patchTask = vi.fn();

vi.mock('./stores', () => ({
  checklists$: () => ({ __tag: 'checklists' }),
  householdTasks$: () => ({ __tag: 'householdTasks' }),
}));

vi.mock('./create-group-store', () => ({
  useStoreHelpers: (store$: { __tag: string }) => {
    switch (store$.__tag) {
      case 'checklists':
        return { writeRow: writeChecklist, patchRow: vi.fn(), softDeleteRow: softDeleteChecklist };
      case 'householdTasks':
        return { writeRow: vi.fn(), patchRow: patchTask, softDeleteRow: vi.fn() };
      default:
        throw new Error(`unexpected store tag ${store$.__tag}`);
    }
  },
}));

// eslint-disable-next-line import/first
import { useAddChecklistToTask } from './use-add-checklist-to-task';

function makeTask(overrides: Partial<HouseholdTask> = {}): HouseholdTask {
  return {
    id: 'task-1',
    group_id: 'group-1',
    title: 'Pack for the trip',
    due_date: '2026-09-20',
    due_time: null,
    offset_days: null,
    recurrence_days: null,
    done: false,
    completed_at: null,
    assigned_to: null,
    private: false,
    template_key: null,
    notes: null,
    sort_order: 0,
    linked_checklist_id: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

beforeEach(() => {
  writeChecklist.mockClear();
  softDeleteChecklist.mockClear();
  patchTask.mockClear();
});

describe('useAddChecklistToTask', () => {
  it('writes the new checklist and patches the task with linked_checklist_id', () => {
    const task = makeTask();
    const { result } = renderHook(() => useAddChecklistToTask(task, 'user-1'));

    let created: { checklist: { id: string }; undo: () => void } | undefined;
    act(() => {
      created = result.current.addChecklist();
    });

    expect(writeChecklist).toHaveBeenCalledTimes(1);
    expect(patchTask).toHaveBeenCalledWith('task-1', { linked_checklist_id: created!.checklist.id });
  });

  it('undo soft-deletes the created checklist and nulls the task link', () => {
    const task = makeTask();
    const { result } = renderHook(() => useAddChecklistToTask(task, 'user-1'));

    let created!: { checklist: { id: string }; undo: () => void };
    act(() => {
      created = result.current.addChecklist();
    });
    patchTask.mockClear();

    act(() => {
      created.undo();
    });

    expect(softDeleteChecklist).toHaveBeenCalledWith(created.checklist.id);
    expect(patchTask).toHaveBeenCalledWith('task-1', { linked_checklist_id: null });
  });
});
