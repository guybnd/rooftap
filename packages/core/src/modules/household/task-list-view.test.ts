import { describe, expect, it } from 'vitest';
import type { ChecklistTaskItem, HouseholdTask } from '../../types';
import {
  checklistItemsByChecklistId,
  compareTasksByDueDateTimeOrder,
  createTaskSnoozeUndo,
  groupTasksByPerson,
  moveInCountdown,
  type TaskUndoPresenterFactory,
} from './task-list-view';
import { bucketTasksByDueDate } from './household-tasks';

function task(overrides: Partial<HouseholdTask> & { id: string }): HouseholdTask {
  return {
    group_id: 'g1',
    title: overrides.id,
    due_date: null,
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

describe('compareTasksByDueDateTimeOrder', () => {
  it('orders same-day timed tasks by due_time, not sort_order (HOUP-220 regression)', () => {
    const tasks = [
      task({ id: 'late', due_date: '2026-08-02', due_time: '18:00', sort_order: 0 }),
      task({ id: 'early', due_date: '2026-08-02', due_time: '09:00', sort_order: 2 }),
      task({ id: 'mid', due_date: '2026-08-02', due_time: '13:30', sort_order: 1 }),
    ];

    expect(tasks.sort(compareTasksByDueDateTimeOrder).map((t) => t.id)).toEqual(['early', 'mid', 'late']);
  });

  it('sorts all-day tasks before timed tasks on the same date', () => {
    const tasks = [
      task({ id: 'timed', due_date: '2026-08-02', due_time: '09:00' }),
      task({ id: 'allday', due_date: '2026-08-02', due_time: null }),
    ];

    expect(tasks.sort(compareTasksByDueDateTimeOrder).map((t) => t.id)).toEqual(['allday', 'timed']);
  });

  it('falls back to sort_order for ties on date and time', () => {
    const tasks = [
      task({ id: 'b', due_date: '2026-08-02', due_time: '09:00', sort_order: 1 }),
      task({ id: 'a', due_date: '2026-08-02', due_time: '09:00', sort_order: 0 }),
    ];

    expect(tasks.sort(compareTasksByDueDateTimeOrder).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('sorts undated tasks after dated ones, by sort_order among themselves', () => {
    const tasks = [
      task({ id: 'undated2', due_date: null, sort_order: 1 }),
      task({ id: 'dated', due_date: '2026-08-02', due_time: '09:00' }),
      task({ id: 'undated1', due_date: null, sort_order: 0 }),
    ];

    expect(tasks.sort(compareTasksByDueDateTimeOrder).map((t) => t.id)).toEqual([
      'dated',
      'undated1',
      'undated2',
    ]);
  });
});

describe('groupTasksByPerson', () => {
  it('puts you first, members in order, others next, Unassigned last', () => {
    const tasks = [
      task({ id: 'u', assigned_to: null }),
      task({ id: 'x', assigned_to: 'outsider' }),
      task({ id: 'b', assigned_to: 'bob' }),
      task({ id: 'me', assigned_to: 'me' }),
      task({ id: 'a', assigned_to: 'amy' }),
    ];
    expect(groupTasksByPerson(tasks, 'me', ['amy', 'me', 'bob']).map((g) => g.key)).toEqual(['me', 'amy', 'bob', 'outsider', 'unassigned']);
  });

  it('sorts each group open first, then by date and time, undated last', () => {
    const tasks = [
      task({ id: 'done', assigned_to: 'me', done: true, due_date: '2026-01-01' }),
      task({ id: 'undated', assigned_to: 'me' }),
      task({ id: 'late', assigned_to: 'me', due_date: '2026-02-01' }),
      task({ id: 'timed', assigned_to: 'me', due_date: '2026-01-05', due_time: '09:00' }),
      task({ id: 'allday', assigned_to: 'me', due_date: '2026-01-05' }),
    ];
    expect(groupTasksByPerson(tasks, 'me', [])[0].tasks.map((t) => t.id)).toEqual(['allday', 'timed', 'late', 'undated', 'done']);
  });
});

describe('bucketTasksByDueDate with lingering ticks', () => {
  it('keeps a just-ticked task in its bucket, in place', () => {
    const today = '2026-10-23';
    const tasks = [
      task({ id: 'a', due_date: '2026-10-24' }),
      task({ id: 'ticked', due_date: '2026-10-25', done: true }),
      task({ id: 'c', due_date: '2026-10-26' }),
      task({ id: 'old', due_date: '2026-10-20', done: true }),
    ];
    const b = bucketTasksByDueDate(tasks, new Set(['ticked']), today);
    expect(b.thisWeek.map((t) => t.id)).toEqual(['a', 'ticked', 'c']);
    expect(b.done.map((t) => t.id)).toEqual(['old']);
    expect(bucketTasksByDueDate(tasks, undefined, today).done.map((t) => t.id)).toEqual(['ticked', 'old']);
  });
});

describe('moveInCountdown', () => {
  it('counts down, names the day, then counts up', () => {
    expect(moveInCountdown(null)).toBeNull();
    expect(moveInCountdown('2026-11-11', '2026-10-23')).toEqual({ label: '19 days until move-in', sub: 'Wed, Nov 11' });
    expect(moveInCountdown('2026-10-24', '2026-10-23')?.label).toBe('1 day until move-in');
    expect(moveInCountdown('2026-10-23', '2026-10-23')?.label).toBe('Move-in day is today');
    expect(moveInCountdown('2026-10-20', '2026-10-23')?.label).toBe('Moved in 3 days ago');
  });
});

describe('checklistItemsByChecklistId', () => {
  it('groups items by checklist in their own order', () => {
    const items = [
      { id: 'i2', checklist_id: 'c1', order: 2 },
      { id: 'i3', checklist_id: 'c2', order: 0 },
      { id: 'i1', checklist_id: 'c1', order: 1 },
    ] as ChecklistTaskItem[];
    const map = checklistItemsByChecklistId(items);
    expect(map.c1.map((i) => i.id)).toEqual(['i1', 'i2']);
    expect(map.c2.map((i) => i.id)).toEqual(['i3']);
  });
});

describe('createTaskSnoozeUndo', () => {
  it('moves the due date and labels the pill', () => {
    const runs: { label: string; patch: Partial<HouseholdTask> }[] = [];
    const factory: TaskUndoPresenterFactory = ({ message }) => ({
      run(row, patch) {
        runs.push({ label: message(1, row), patch });
      },
    });
    const snooze = createTaskSnoozeUndo(factory, () => {});
    snooze(task({ id: 't', due_date: '2026-10-23' }), '1d', '2026-10-23');
    expect(runs[0].patch.due_date).toBe('2026-10-24');
    expect(runs[0].label.length).toBeGreaterThan(0);
  });
});
