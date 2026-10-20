import { describe, expect, it } from 'vitest';
import {
  applyTaskCompletion,
  bucketTasksByDueDate,
  DEFAULT_UPCOMING_WINDOW_DAYS,
  nextOccurrenceISO,
  splitUpcomingByWindow,
  taskFieldPatch,
  upcomingWindowDays,
} from './household-tasks';
import type { HouseholdTask } from './types';

function task(overrides: Partial<HouseholdTask>): HouseholdTask {
  return {
    id: 'test-id',
    group_id: 'test-group',
    title: 'Test task',
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
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

describe('nextOccurrenceISO', () => {
  it('advances from the due date by recurrence_days', () => {
    // Due date is deliberately in the future so the "never in the past"
    // rollover below is a no-op here — that behavior gets its own test.
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const futureISO = future.toISOString().slice(0, 10);
    const [y, m, d] = futureISO.split('-').map(Number);
    const expected = new Date(y, m - 1, d + 7);
    const expectedISO = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
    expect(nextOccurrenceISO(futureISO, 7)).toBe(expectedISO);
  });

  it('falls back to today when there is no due date', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(nextOccurrenceISO(null, 1) >= today).toBe(true);
  });

  it('rolls forward past today for a due date long in the past', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(nextOccurrenceISO('2020-01-01', 7) >= today).toBe(true);
  });
});

describe('bucketTasksByDueDate', () => {
  it('separates done tasks regardless of due date', () => {
    const buckets = bucketTasksByDueDate([task({ id: 'a', done: true, due_date: '2020-01-01' })]);
    expect(buckets.done).toHaveLength(1);
    expect(buckets.overdue).toHaveLength(0);
  });

  it('buckets an undated task as upcoming', () => {
    const buckets = bucketTasksByDueDate([task({ id: 'a', due_date: null })]);
    expect(buckets.upcoming).toHaveLength(1);
  });

  it('buckets a past-due task as overdue', () => {
    const buckets = bucketTasksByDueDate([task({ id: 'a', due_date: '2020-01-01' })]);
    expect(buckets.overdue).toHaveLength(1);
  });

  it('buckets a far-future task as upcoming, not this week', () => {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 30);
    const buckets = bucketTasksByDueDate([task({ id: 'a', due_date: farFuture.toISOString().slice(0, 10) })]);
    expect(buckets.upcoming).toHaveLength(1);
    expect(buckets.thisWeek).toHaveLength(0);
  });
});

describe('splitUpcomingByWindow', () => {
  const today = '2026-10-18';

  it('keeps tasks due within the window and on its last day', () => {
    const { upcoming, later } = splitUpcomingByWindow(
      [task({ id: 'a', due_date: '2026-11-01' }), task({ id: 'b', due_date: '2027-01-16' })],
      90,
      today
    );
    expect(upcoming.map((t) => t.id)).toEqual(['a', 'b']);
    expect(later).toHaveLength(0);
  });

  it('moves tasks due past the window to later', () => {
    const { upcoming, later } = splitUpcomingByWindow([task({ id: 'a', due_date: '2027-01-17' })], 90, today);
    expect(upcoming).toHaveLength(0);
    expect(later.map((t) => t.id)).toEqual(['a']);
  });

  it('always keeps undated tasks in upcoming', () => {
    const { upcoming, later } = splitUpcomingByWindow([task({ id: 'a', due_date: null })], 1, today);
    expect(upcoming).toHaveLength(1);
    expect(later).toHaveLength(0);
  });
});

describe('upcomingWindowDays', () => {
  it('defaults to 90 days when unset or invalid', () => {
    expect(DEFAULT_UPCOMING_WINDOW_DAYS).toBe(90);
    expect(upcomingWindowDays(null)).toBe(90);
    expect(upcomingWindowDays({ tasks_upcoming_days: null })).toBe(90);
    expect(upcomingWindowDays({ tasks_upcoming_days: 0 })).toBe(90);
  });

  it('uses the stored window', () => {
    expect(upcomingWindowDays({ tasks_upcoming_days: 365 })).toBe(365);
  });
});

describe('applyTaskCompletion', () => {
  it('done -> open clears completed_at and never creates a next occurrence', () => {
    const result = applyTaskCompletion(task({ done: true, completed_at: '2026-06-15T09:00:00.000Z', recurrence_days: 7 }), false, { nextId: 'next-1' });
    expect(result).toEqual({ update: { done: false, completed_at: null }, createNextOccurrence: null });
  });

  it('open -> done stamps completed_at and creates no next occurrence for a non-recurring task', () => {
    const now = new Date('2026-06-20T10:00:00.000Z');
    const result = applyTaskCompletion(task({ recurrence_days: null }), true, { nextId: 'next-1', now });
    expect(result.update).toEqual({ done: true, completed_at: now.toISOString() });
    expect(result.createNextOccurrence).toBeNull();
  });

  it('completing a recurring task creates exactly one next occurrence with the supplied id', () => {
    const now = new Date('2026-06-20T10:00:00.000Z');
    const source = task({ id: 'src', due_date: '2026-06-20', recurrence_days: 7, title: 'Water plants', assigned_to: 'user-1' });
    const result = applyTaskCompletion(source, true, { nextId: 'preassigned-next', now });
    expect(result.createNextOccurrence).toMatchObject({
      id: 'preassigned-next',
      title: 'Water plants',
      due_date: nextOccurrenceISO('2026-06-20', 7),
      recurrence_days: 7,
      done: false,
      completed_at: null,
      assigned_to: 'user-1',
    });
  });

  it('replaying the same completion event with the same preassigned id is idempotent at the call level (same next id every time)', () => {
    const source = task({ due_date: '2026-06-20', recurrence_days: 7 });
    const first = applyTaskCompletion(source, true, { nextId: 'stable-id' });
    const second = applyTaskCompletion(source, true, { nextId: 'stable-id' });
    expect(first.createNextOccurrence?.id).toBe('stable-id');
    expect(second.createNextOccurrence?.id).toBe('stable-id');
  });
});

describe('taskFieldPatch', () => {
  it('trims a title and refuses an empty one', () => {
    expect(taskFieldPatch(task({}), 'title', '  Call the plumber ')).toEqual({ title: 'Call the plumber' });
    expect(taskFieldPatch(task({}), 'title', '   ')).toBeNull();
  });

  it('clears an emptied due date or notes', () => {
    expect(taskFieldPatch(task({ due_date: '2026-06-20' }), 'due_date', '')).toEqual({ due_date: null });
    expect(taskFieldPatch(task({ notes: 'x' }), 'notes', '  ')).toEqual({ notes: null });
    expect(taskFieldPatch(task({}), 'notes', ' Ring first ')).toEqual({ notes: 'Ring first' });
  });

  it('detaches a moving-template task from the template when its date is set by hand', () => {
    const moving = task({ template_key: 'moving:pack-kitchen', offset_days: -3 });
    expect(taskFieldPatch(moving, 'due_date', '2026-06-21')).toEqual({
      due_date: '2026-06-21',
      template_key: null,
      offset_days: null,
    });
  });

  it('keeps a reminder task on its template so the origin backlink survives', () => {
    const reminder = task({ template_key: 'cost-reminder:abc:contract', offset_days: null });
    expect(taskFieldPatch(reminder, 'due_date', '2026-06-21')).toEqual({ due_date: '2026-06-21' });
  });
});
