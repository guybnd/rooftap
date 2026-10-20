import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOTION_DURATIONS_MS, type HouseholdTask } from '@homeup/core';
import { closeThenCommit, createHouseholdTaskModalCallbacks } from './deferred-sheet-close';

function task(overrides: Partial<HouseholdTask> = {}): HouseholdTask {
  return {
    id: 'task-1',
    group_id: 'group-1',
    title: 'Book movers',
    due_date: '2026-08-03',
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
    priority: 'medium',
    created_at: '2026-08-03T00:00:00.000Z',
    updated_at: '2026-08-03T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// HOUP-191 regression (user-reported "list yanks the sheet mid-edit" bug):
// apps/mobile/src/app/(tabs)/tasks/index.tsx's HouseholdTaskModal onClose/onSave/
// onDelete all route through this helper so the sheet's `open` flag flips
// synchronously (Cancel/backdrop/drag/back animate normally) while the store
// write + clearing the keyed `editingTask` id — which would otherwise remount
// the sheet mid-close and skip its exit animation — waits for the exit
// animation to finish.
describe('closeThenCommit', () => {
  it('flips open synchronously, before the commit runs', () => {
    vi.useFakeTimers();
    const setOpen = vi.fn();
    const commit = vi.fn();

    closeThenCommit(setOpen, commit);

    expect(setOpen).toHaveBeenCalledTimes(1);
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it('defers the commit until exactly MOTION_DURATIONS_MS.exit has elapsed', () => {
    vi.useFakeTimers();
    const commit = vi.fn();

    closeThenCommit(vi.fn(), commit);

    vi.advanceTimersByTime(MOTION_DURATIONS_MS.exit - 1);
    expect(commit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('createHouseholdTaskModalCallbacks', () => {
  it('wires Cancel/backdrop/drag/back to close first, then clear the edited task without writing', () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const setModalOpen = vi.fn((open: boolean) => events.push(`setModalOpen:${String(open)}`));
    const setEditingTask = vi.fn((next: HouseholdTask | undefined) => {
      events.push(`setEditingTask:${next?.id ?? 'undefined'}`);
    });
    const writeRow = vi.fn((saved: HouseholdTask) => events.push(`writeRow:${saved.id}`));
    const softDeleteRow = vi.fn((taskId: string) => events.push(`softDeleteRow:${taskId}`));
    const pinNewTask = vi.fn((taskId: string) => events.push(`pinNewTask:${taskId}`));

    const callbacks = createHouseholdTaskModalCallbacks({
      editingTask: task({ id: 'visible-task' }),
      setModalOpen,
      setEditingTask,
      writeRow,
      softDeleteRow,
      pinNewTask,
    });

    callbacks.onClose();

    expect(events).toEqual(['setModalOpen:false']);
    expect(writeRow).not.toHaveBeenCalled();
    expect(softDeleteRow).not.toHaveBeenCalled();
    expect(pinNewTask).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MOTION_DURATIONS_MS.exit);

    expect(events).toEqual(['setModalOpen:false', 'setEditingTask:undefined']);
    expect(writeRow).not.toHaveBeenCalled();
    expect(softDeleteRow).not.toHaveBeenCalled();
    expect(pinNewTask).not.toHaveBeenCalled();
  });

  it('wires Save for an edited task to close before writing and clearing the edited task', () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const visibleTask = task({ id: 'visible-task', due_date: '2026-08-03' });
    const savedTask = task({ id: 'visible-task', due_date: '2026-09-10' });
    const setModalOpen = vi.fn((open: boolean) => events.push(`setModalOpen:${String(open)}`));
    const setEditingTask = vi.fn((next: HouseholdTask | undefined) => {
      events.push(`setEditingTask:${next?.id ?? 'undefined'}`);
    });
    const writeRow = vi.fn((saved: HouseholdTask) => events.push(`writeRow:${saved.id}:${saved.due_date}`));
    const softDeleteRow = vi.fn((taskId: string) => events.push(`softDeleteRow:${taskId}`));
    const pinNewTask = vi.fn((taskId: string) => events.push(`pinNewTask:${taskId}`));

    const callbacks = createHouseholdTaskModalCallbacks({
      editingTask: visibleTask,
      setModalOpen,
      setEditingTask,
      writeRow,
      softDeleteRow,
      pinNewTask,
    });

    callbacks.onSave(savedTask);

    expect(events).toEqual(['setModalOpen:false']);
    expect(writeRow).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MOTION_DURATIONS_MS.exit);

    expect(events).toEqual([
      'setModalOpen:false',
      'writeRow:visible-task:2026-09-10',
      'setEditingTask:undefined',
    ]);
    expect(writeRow).toHaveBeenCalledWith(savedTask);
    expect(pinNewTask).not.toHaveBeenCalled();
    expect(softDeleteRow).not.toHaveBeenCalled();
  });

  it('wires Save for a new task to write after close, then pin and clear it', () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const savedTask = task({ id: 'new-task', title: 'New task' });
    const setModalOpen = vi.fn((open: boolean) => events.push(`setModalOpen:${String(open)}`));
    const setEditingTask = vi.fn((next: HouseholdTask | undefined) => {
      events.push(`setEditingTask:${next?.id ?? 'undefined'}`);
    });
    const writeRow = vi.fn((saved: HouseholdTask) => events.push(`writeRow:${saved.id}`));
    const softDeleteRow = vi.fn((taskId: string) => events.push(`softDeleteRow:${taskId}`));
    const pinNewTask = vi.fn((taskId: string) => events.push(`pinNewTask:${taskId}`));

    const callbacks = createHouseholdTaskModalCallbacks({
      editingTask: undefined,
      setModalOpen,
      setEditingTask,
      writeRow,
      softDeleteRow,
      pinNewTask,
    });

    callbacks.onSave(savedTask);

    expect(events).toEqual(['setModalOpen:false']);

    vi.advanceTimersByTime(MOTION_DURATIONS_MS.exit);

    expect(events).toEqual([
      'setModalOpen:false',
      'writeRow:new-task',
      'pinNewTask:new-task',
      'setEditingTask:undefined',
    ]);
    expect(writeRow).toHaveBeenCalledWith(savedTask);
    expect(pinNewTask).toHaveBeenCalledWith('new-task');
    expect(softDeleteRow).not.toHaveBeenCalled();
  });

  it('wires Delete to close before soft-deleting and clearing the edited task', () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const setModalOpen = vi.fn((open: boolean) => events.push(`setModalOpen:${String(open)}`));
    const setEditingTask = vi.fn((next: HouseholdTask | undefined) => {
      events.push(`setEditingTask:${next?.id ?? 'undefined'}`);
    });
    const writeRow = vi.fn((saved: HouseholdTask) => events.push(`writeRow:${saved.id}`));
    const softDeleteRow = vi.fn((taskId: string) => events.push(`softDeleteRow:${taskId}`));
    const pinNewTask = vi.fn((taskId: string) => events.push(`pinNewTask:${taskId}`));

    const callbacks = createHouseholdTaskModalCallbacks({
      editingTask: task({ id: 'visible-task' }),
      setModalOpen,
      setEditingTask,
      writeRow,
      softDeleteRow,
      pinNewTask,
    });

    callbacks.onDelete('visible-task');

    expect(events).toEqual(['setModalOpen:false']);
    expect(softDeleteRow).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MOTION_DURATIONS_MS.exit);

    expect(events).toEqual([
      'setModalOpen:false',
      'softDeleteRow:visible-task',
      'setEditingTask:undefined',
    ]);
    expect(softDeleteRow).toHaveBeenCalledWith('visible-task');
    expect(writeRow).not.toHaveBeenCalled();
    expect(pinNewTask).not.toHaveBeenCalled();
  });
});
