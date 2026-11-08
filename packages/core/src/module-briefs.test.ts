import { describe, expect, it } from 'vitest';
import { moneyBrief } from './modules/costs/helper-brief';
import { weekBrief } from './modules/household/helper-brief';
import { dinnersBrief } from './modules/meals/helper-brief';
import { giftsBrief } from './modules/occasions/helper-brief';
import type { CostItem, HouseholdTask, Recipe } from './types';
import type { MealPlanEntry } from './modules/meals/meal-plan';
import type { GiftIdea, Occasion } from './modules/occasions/occasions';

const today = '2026-11-08';

const cost = (over: Partial<CostItem>): CostItem =>
  ({
    id: over.name ?? 'c',
    group_id: 'g',
    name: 'Power',
    category: 'utilities',
    amount: 12000,
    cadence: 'monthly',
    is_estimate: false,
    start_date: '2026-01-10',
    end_date: null,
    discount_end_date: null,
    provider: null,
    assigned_to: null,
    linked_section: null,
    notes: null,
    sort_order: 0,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted: false,
    ...over,
  }) as CostItem;

const task = (over: Partial<HouseholdTask>): HouseholdTask =>
  ({
    id: over.title ?? 't',
    group_id: 'g',
    title: 'Task',
    due_date: today,
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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted: false,
    ...over,
  }) as HouseholdTask;

describe('Money brief', () => {
  it('lists the bills due this week as cost rows, and deals ending soon', () => {
    const brief = moneyBrief({
      today,
      items: [
        cost({ name: 'Power' }),
        cost({ name: 'Rent', start_date: '2026-11-20', amount: 200000 }),
        cost({ name: 'Internet', start_date: '2026-01-09', discount_end_date: '2026-12-01' }),
        cost({ name: 'Old', deleted: true }),
      ],
    });
    const due = brief.sections.find((s) => s.id === 'due')!;
    expect(due.module).toBe('costs');
    expect(due.rows.map((r) => r.title)).toEqual(['Internet', 'Power']);
    expect(brief.sections.find((s) => s.id === 'ending')?.rows.map((r) => r.title)).toEqual(['Internet']);
    expect(brief.lede).toMatch(/^2 bills due this week/);
  });
});

describe('Week brief', () => {
  it('splits open to-dos into overdue, today and later this week', () => {
    const brief = weekBrief({
      today,
      me: 'me',
      tasks: [
        task({ title: 'Late', due_date: '2026-11-01', assigned_to: 'me' }),
        task({ title: 'Now' }),
        task({ title: 'Soon', due_date: '2026-11-10' }),
        task({ title: 'Far', due_date: '2026-12-10' }),
        task({ title: 'Done', done: true }),
      ],
    });
    expect(brief.sections.map((s) => [s.id, s.rows.map((r) => r.title)])).toEqual([
      ['late', ['Late']],
      ['today', ['Now']],
      ['week', ['Soon']],
    ]);
    expect(brief.sections.every((s) => s.module === 'household')).toBe(true);
    expect(brief.lede).toBe('1 overdue, 1 for today, 1 later this week. One of the urgent ones is yours. The oldest has waited 7 days.');
  });
});

describe('Dinners brief', () => {
  it('shows the next seven nights and which are open', () => {
    const recipe = { id: 'r1', title: 'Green curry', deleted: false } as Recipe;
    const entry = { id: 'e1', date: '2026-11-09', slot: 'dinner', recipe_id: 'r1', label: null, deleted: false, updated_at: '' } as unknown as MealPlanEntry;
    const brief = dinnersBrief({ entries: [entry], recipes: [recipe], today });
    const rows = brief.sections[0].rows;
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ title: 'Tonight', meta: 'Nothing planned', warn: true });
    expect(rows[1]).toMatchObject({ title: 'Tomorrow', meta: 'Green curry' });
    expect(brief.title).toBe("What's for dinner tonight?");
    expect(brief.lede).toMatch(/^1 of the next seven nights planned/);
  });
});

describe('Gifts brief', () => {
  it('lists occasions in the next weeks with where each gift stands', () => {
    const occ = (id: string, date: string): Occasion => ({ id, group_id: 'g', title: id, kind: 'other', date, repeats: false, person_id: null, person_name: null, budget_cents: null, notes: null, hidden_from: [], created_by: null, created_at: '', deleted: false }) as unknown as Occasion;
    const idea = (occasion_id: string, status: GiftIdea['status']) => ({ id: `${occasion_id}${status}`, occasion_id, status, deleted: false, hidden_from: [] }) as unknown as GiftIdea;
    const brief = giftsBrief({
      today,
      occasions: [occ('Party', '2026-11-12'), occ('Later', '2027-03-01'), occ('Anniversary', '2026-12-01')],
      ideas: [idea('Anniversary', 'bought')],
    });
    expect(brief.sections[0].rows.map((r) => [r.title, r.meta])).toEqual([
      ['Party', 'No gift ideas yet'],
      ['Anniversary', 'Gift sorted'],
    ]);
    expect(brief.title).toBe('A gift to sort soon');
  });
});
