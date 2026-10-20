import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateMovingTasks,
  findOutOfSyncTasks,
  syncMovingTaskDates,
  getMovingPhase,
  isMovingActive,
  describeMovingPhase,
  SETTLED_AFTER_DAYS,
} from './moving-tasks';
import { addDaysISO } from './date-utils';
import { getRegionProvider } from './region';
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

// Minimal stub of the two query-builder chains generateMovingTasks/
// syncMovingTaskDates actually call — `.from(...).insert(...)` and
// `.from(...).update(...).eq(...)` — rather than a full SupabaseClient mock.
function stubClient({ inserted = [] as unknown[], updated = [] as { id: string; due_date: string }[] } = {}) {
  const calls = { inserted, updated };
  const client = {
    from: () => ({
      insert: (rows: unknown[]) => {
        calls.inserted.push(...rows);
        return Promise.resolve({ error: null });
      },
      update: (patch: { due_date: string }) => ({
        eq: (_col: string, id: string) => {
          calls.updated.push({ id, due_date: patch.due_date });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('generateMovingTasks', () => {
  it('is idempotent — skips template_keys that already exist', async () => {
    const { client, calls } = stubClient();
    const inserted = await generateMovingTasks({
      groupId: 'g1',
      region: 'AU',
      moveInDate: '2026-07-01',
      existingTemplateKeys: new Set(['move-give-notice']),
      supabase: client,
    });
    expect(inserted).toBeGreaterThan(0);
    expect(calls.inserted.some((r: any) => r.template_key === 'move-give-notice')).toBe(false);
  });

  it('inserts every template task when nothing exists yet', async () => {
    const { client, calls } = stubClient();
    const inserted = await generateMovingTasks({
      groupId: 'g1',
      region: 'AU',
      moveInDate: '2026-07-01',
      existingTemplateKeys: new Set(),
      supabase: client,
    });
    expect(inserted).toBe(calls.inserted.length);
    expect(calls.inserted.length).toBeGreaterThan(0);
  });

  it('creates a null due_date when there is no move-in date, keeping offset_days for later sync', async () => {
    const { client, calls } = stubClient();
    await generateMovingTasks({
      groupId: 'g1',
      region: 'AU',
      moveInDate: null,
      existingTemplateKeys: new Set(),
      supabase: client,
    });
    for (const row of calls.inserted as any[]) {
      expect(row.due_date).toBeNull();
      expect(row.offset_days).not.toBeNull();
    }
  });

  it('returns 0 and makes no insert call when every template_key already exists', async () => {
    const { client, calls } = stubClient();
    const allKeys = new Set(getRegionProvider('AU').movingTasks.map((t) => t.template_key));
    const inserted = await generateMovingTasks({
      groupId: 'g1',
      region: 'AU',
      moveInDate: '2026-07-01',
      existingTemplateKeys: allKeys,
      supabase: client,
    });
    expect(inserted).toBe(0);
    expect(calls.inserted).toHaveLength(0);
  });
});

describe('findOutOfSyncTasks', () => {
  it('returns nothing when there is no move-in date', () => {
    const tasks = [task({ template_key: 'move-x', offset_days: -7, due_date: '2026-06-20' })];
    expect(findOutOfSyncTasks(tasks, null)).toHaveLength(0);
  });

  it('flags a template task whose due_date no longer matches moveInDate + offset_days', () => {
    const tasks = [task({ template_key: 'move-x', offset_days: -7, due_date: '2026-06-20' })];
    expect(findOutOfSyncTasks(tasks, '2026-07-01')).toHaveLength(1);
  });

  it('ignores manual tasks (no template_key)', () => {
    const tasks = [task({ template_key: null, offset_days: null, due_date: '2026-06-20' })];
    expect(findOutOfSyncTasks(tasks, '2026-07-01')).toHaveLength(0);
  });

  it('ignores completed template tasks', () => {
    const tasks = [task({ template_key: 'move-x', offset_days: -7, due_date: '2026-06-20', done: true })];
    expect(findOutOfSyncTasks(tasks, '2026-07-01')).toHaveLength(0);
  });

  it('does not flag a template task already in sync', () => {
    const tasks = [task({ template_key: 'move-x', offset_days: -7, due_date: '2026-06-24' })];
    expect(findOutOfSyncTasks(tasks, '2026-07-01')).toHaveLength(0);
  });
});

describe('syncMovingTaskDates', () => {
  it('updates every out-of-sync task and returns the count', async () => {
    const { client, calls } = stubClient();
    const tasks = [
      task({ id: 'a', template_key: 'move-x', offset_days: -7, due_date: '2026-06-20' }),
      task({ id: 'b', template_key: 'move-y', offset_days: 0, due_date: '2026-06-25' }),
    ];
    const count = await syncMovingTaskDates({ tasks, moveInDate: '2026-07-01', supabase: client });
    expect(count).toBe(2);
    expect(calls.updated).toEqual(
      expect.arrayContaining([
        { id: 'a', due_date: '2026-06-24' },
        { id: 'b', due_date: '2026-07-01' },
      ])
    );
  });

  it('returns 0 and makes no update call when there is no move-in date', async () => {
    const { client, calls } = stubClient();
    const tasks = [task({ id: 'a', template_key: 'move-x', offset_days: -7, due_date: '2026-06-20' })];
    const count = await syncMovingTaskDates({ tasks, moveInDate: null, supabase: client });
    expect(count).toBe(0);
    expect(calls.updated).toHaveLength(0);
  });
});

describe('getMovingPhase / isMovingActive', () => {
  const TODAY = '2026-09-09';

  it('is inactive with no move-in date, so no moving UI renders at all', () => {
    expect(getMovingPhase(null, TODAY)).toBe('inactive');
    expect(getMovingPhase(undefined, TODAY)).toBe('inactive');
    expect(isMovingActive(null, TODAY)).toBe(false);
  });

  it('is preparing while move-in day is ahead, and on the day itself', () => {
    expect(getMovingPhase('2026-12-01', TODAY)).toBe('preparing');
    expect(getMovingPhase(TODAY, TODAY)).toBe('preparing');
    expect(isMovingActive('2026-12-01', TODAY)).toBe(true);
  });

  it('stays active through the settling window, covering the +N tasks', () => {
    // The AU and DE templates both run to +14, so those must still be offered.
    expect(getMovingPhase('2026-08-26', TODAY)).toBe('settling');
    expect(isMovingActive('2026-08-26', TODAY)).toBe(true);
  });

  it('retires itself once the move is history', () => {
    expect(getMovingPhase('2025-01-01', TODAY)).toBe('settled');
    expect(isMovingActive('2025-01-01', TODAY)).toBe(false);
  });

  it('switches from settling to settled exactly at the boundary', () => {
    // SETTLED_AFTER_DAYS days ago is the last active day.
    const lastActive = addDaysISO(TODAY, -SETTLED_AFTER_DAYS);
    const firstSettled = addDaysISO(TODAY, -(SETTLED_AFTER_DAYS + 1));
    expect(getMovingPhase(lastActive, TODAY)).toBe('settling');
    expect(getMovingPhase(firstSettled, TODAY)).toBe('settled');
  });
});

describe('describeMovingPhase', () => {
  const TODAY = '2026-09-09';

  it('tells an unset field that it is the on switch', () => {
    expect(describeMovingPhase(null, TODAY)).toBe(
      'Set a date to turn on the moving checklist and countdown.'
    );
  });

  it('counts down, singularising one day', () => {
    expect(describeMovingPhase('2026-09-19', TODAY)).toBe(
      '10 days until move-in. The moving checklist is on.'
    );
    expect(describeMovingPhase('2026-09-10', TODAY)).toBe(
      '1 day until move-in. The moving checklist is on.'
    );
    expect(describeMovingPhase(TODAY, TODAY)).toBe('Move-in day is today. The moving checklist is on.');
  });

  it('says when the checklist will retire while settling', () => {
    expect(describeMovingPhase('2026-09-08', TODAY)).toBe(
      'Moved in 1 day ago. The moving checklist retires in 44 days.'
    );
  });

  it('explains how to turn it back on once settled', () => {
    expect(describeMovingPhase('2020-01-01', TODAY)).toBe(
      'The move is done, so the moving checklist is off. Set a new date to turn it back on.'
    );
  });

  it('never leaks an em-dash or emoji into UI copy (Hearth H6)', () => {
    const all = [null, '2026-09-19', TODAY, '2026-09-08', '2020-01-01'].map((d) =>
      describeMovingPhase(d, TODAY)
    );
    for (const line of all) {
      expect(line).not.toMatch(/[—\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});
