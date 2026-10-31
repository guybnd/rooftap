import { describe, expect, it } from 'vitest';
import type { Apartment, Checklist, ChecklistItem, ChecklistResponse, ChecklistTaskItem, SetupItem } from '../types';
import { homeChecklistMaps, homeSetupProgress, liveRows, scoreApartments } from './use-home-data';

const apt = (id: string) => ({ id, address: id }) as unknown as Apartment;
const criterion = (id: string, weight: number) =>
  ({ id, weight, is_dealbreaker: false, is_bonus: false, deleted: false }) as unknown as ChecklistItem;
const response = (apartment_id: string, checklist_item_id: string, value: boolean | null) =>
  ({ apartment_id, checklist_item_id, value }) as unknown as ChecklistResponse;

describe('scoreApartments', () => {
  it('scores a listing with answers and leaves an unanswered one unscored', () => {
    const [a, b] = scoreApartments([apt('a'), apt('b')], [criterion('q1', 5), criterion('q2', 5)], [response('a', 'q1', true), response('a', 'q2', false)]);
    expect(a.score?.percentage).toBe(50);
    expect(b.score).toBeNull();
  });
});

describe('homeChecklistMaps', () => {
  const checklist = (id: string, linked_task_id: string | null) => ({ id, linked_task_id }) as unknown as Checklist;
  const task = (id: string, checklist_id: string, order: number, is_done: boolean) =>
    ({ id, checklist_id, order, is_done }) as unknown as ChecklistTaskItem;

  it('indexes checklists, orders their items and links each to its task', () => {
    const maps = homeChecklistMaps(
      [checklist('c1', 't1'), checklist('c2', null)],
      [task('x', 'c1', 2, false), task('y', 'c1', 1, true), task('z', 'c2', 1, false)]
    );
    expect(Object.keys(maps.checklistsById)).toEqual(['c1', 'c2']);
    expect(maps.checklistItemsByChecklistId.c1.map((i) => i.id)).toEqual(['y', 'x']);
    expect(maps.checklistByTaskId).toEqual({
      t1: { href: '/checklists/c1', completionLabel: expect.any(String), completion: { done: 1, total: 2 } },
    });
  });
});

describe('homeSetupProgress', () => {
  it('counts installed items out of all', () => {
    const items = ['installed', 'needed', 'installed'].map((status) => ({ status }) as unknown as SetupItem);
    expect(homeSetupProgress(items)).toEqual({ done: 2, total: 3 });
  });
});

describe('liveRows', () => {
  it('keeps whole rows and drops tombstones, Symbol(delete) values and partial objects', () => {
    const record = {
      a: { id: 'a', title: 'Bins', deleted: false },
      b: { id: 'b', title: 'Gone', deleted: true },
      c: Symbol('delete'),
      d: { updated_at: '2026-10-30T00:00:00Z' },
      e: undefined,
    } as unknown as Record<string, { id: string; title: string; deleted: boolean }>;
    expect(liveRows(record).map((r) => r.id)).toEqual(['a']);
  });
});
