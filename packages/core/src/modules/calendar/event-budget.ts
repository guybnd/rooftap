// Ticket prices into the Budget (household feedback: "if can map prices to our
// budget"). An event with a cost owns one cost_items line, category "outing"
// (Going out), linked both ways: events.cost_item_id points at it and the
// line's linked_section is 'calendar'. Gated on the calendar.budget feature
// (Calendar and Costs both on).

import type { CostItem, GroupEvent } from '../../types';

/** The Budget line for an event's cost, dated the day it was added (when the tickets were bought). */
export function buildEventCost(input: {
  event: Pick<GroupEvent, 'group_id' | 'title'>;
  amountCents: number;
  id: string;
  today: string;
  createdBy?: string | null;
}): CostItem {
  const now = new Date().toISOString();
  return {
    id: input.id,
    group_id: input.event.group_id,
    name: input.event.title,
    category: 'outing',
    amount: input.amountCents,
    cadence: 'one_off',
    is_estimate: false,
    start_date: input.today,
    end_date: null,
    discount_end_date: null,
    provider: null,
    assigned_to: null,
    linked_section: 'calendar',
    notes: null,
    sort_order: 0,
    created_by: input.createdBy ?? null,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

export type EventCostChange =
  | { kind: 'none' }
  | { kind: 'create'; cost: CostItem }
  | { kind: 'update'; id: string; patch: Pick<CostItem, 'name' | 'amount'> }
  | { kind: 'remove'; id: string };

/**
 * What saving an event does to its Budget line, given the amount on the form
 * (null or 0 = no cost). Returns the event to write too, with its link set or cleared.
 */
export function planEventCost<E extends Pick<GroupEvent, 'group_id' | 'title' | 'cost_item_id'>>(input: {
  event: E;
  /** The event's current line, when it has one that still exists. */
  existing: Pick<CostItem, 'id' | 'name' | 'amount'> | null;
  amountCents: number | null;
  newId: () => string;
  today: string;
  createdBy?: string | null;
}): { event: E; change: EventCostChange } {
  const { event, existing } = input;
  const amount = input.amountCents && input.amountCents > 0 ? Math.round(input.amountCents) : null;
  if (amount === null) {
    if (existing) return { event: { ...event, cost_item_id: null }, change: { kind: 'remove', id: existing.id } };
    return { event: event.cost_item_id ? { ...event, cost_item_id: null } : event, change: { kind: 'none' } };
  }
  if (existing) {
    const linked = { ...event, cost_item_id: existing.id };
    if (existing.amount === amount && existing.name === event.title) return { event: linked, change: { kind: 'none' } };
    return { event: linked, change: { kind: 'update', id: existing.id, patch: { name: event.title, amount } } };
  }
  const cost = buildEventCost({ event, amountCents: amount, id: input.newId(), today: input.today, createdBy: input.createdBy });
  return { event: { ...event, cost_item_id: cost.id }, change: { kind: 'create', cost } };
}
