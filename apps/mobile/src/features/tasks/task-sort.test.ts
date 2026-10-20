import { describe, expect, it } from 'vitest';
import type { HouseholdTask } from '@homeup/core';
import { compareTasksByDueDateTimeOrder } from './task-sort';

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
