import { describe, expect, it } from 'vitest';
import { planEventCost } from './event-budget';

const event = { id: 'e1', group_id: 'g1', title: 'Gig', cost_item_id: null as string | null };
const base = { newId: () => 'c-new', today: '2026-10-19', createdBy: 'u1' };

describe('planEventCost', () => {
  it('creates a Going out line and links it', () => {
    const { event: saved, change } = planEventCost({ ...base, event, existing: null, amountCents: 17800 });
    expect(saved.cost_item_id).toBe('c-new');
    expect(change).toMatchObject({
      kind: 'create',
      cost: { id: 'c-new', group_id: 'g1', name: 'Gig', category: 'outing', amount: 17800, cadence: 'one_off', start_date: '2026-10-19', linked_section: 'calendar', created_by: 'u1' },
    });
  });

  it('updates the line when the amount or title changed, and leaves it otherwise', () => {
    const linked = { ...event, cost_item_id: 'c1', title: 'Gig night' };
    expect(planEventCost({ ...base, event: linked, existing: { id: 'c1', name: 'Gig', amount: 17800 }, amountCents: 17800 }).change).toEqual({
      kind: 'update',
      id: 'c1',
      patch: { name: 'Gig night', amount: 17800 },
    });
    expect(planEventCost({ ...base, event: linked, existing: { id: 'c1', name: 'Gig night', amount: 17800 }, amountCents: 17800 }).change).toEqual({ kind: 'none' });
  });

  it('removes the line when the cost is cleared', () => {
    const linked = { ...event, cost_item_id: 'c1' };
    const { event: saved, change } = planEventCost({ ...base, event: linked, existing: { id: 'c1', name: 'Gig', amount: 100 }, amountCents: 0 });
    expect(saved.cost_item_id).toBeNull();
    expect(change).toEqual({ kind: 'remove', id: 'c1' });
  });

  it('drops a link to a line that no longer exists', () => {
    const { event: saved, change } = planEventCost({ ...base, event: { ...event, cost_item_id: 'gone' }, existing: null, amountCents: null });
    expect(saved.cost_item_id).toBeNull();
    expect(change).toEqual({ kind: 'none' });
  });
});
