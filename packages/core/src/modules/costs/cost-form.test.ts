import { describe, expect, it } from 'vitest';
import type { CostItem } from '../../types';
import {
  costFormFrom,
  costNeedsReminderSync,
  costRowFromForm,
  newCostLine,
  rentCostLine,
  setupCostLine,
} from './cost-form';

function cost(overrides: Partial<CostItem> = {}): CostItem {
  return {
    id: 'c1',
    group_id: 'g1',
    name: 'Internet',
    category: 'internet',
    amount: 8000,
    cadence: 'monthly',
    is_estimate: false,
    provider: 'Aussie',
    start_date: '2026-01-01',
    end_date: '2027-01-01',
    discount_end_date: '2026-12-01',
    assigned_to: null,
    linked_section: null,
    notes: null,
    sort_order: 0,
    created_by: 'u1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  } as CostItem;
}

const fresh = { id: 'new1', createdBy: 'u1', stamp: null };

describe('costFormFrom', () => {
  it('starts a new cost as a one-off Purchase with the given defaults', () => {
    expect(costFormFrom(undefined, { name: 'Couch', startDate: '2026-10-23' })).toMatchObject({
      name: 'Couch',
      category: 'purchase',
      cadence: 'one_off',
      amount: null,
      start_date: '2026-10-23',
    });
  });

  it('shows an item in dollars, with empty strings for missing fields', () => {
    const form = costFormFrom(cost({ notes: null, provider: null }));
    expect(form.amount).toBe(80);
    expect(form.provider).toBe('');
    expect(form.notes).toBe('');
  });
});

describe('costRowFromForm', () => {
  it('keeps the item and saves the edits, rounding to cents', () => {
    const item = cost();
    const row = costRowFromForm({ ...costFormFrom(item), name: ' Internet NBN ', amount: 85.499 }, { item, groupId: 'g1', fresh });
    expect(row).toMatchObject({ id: 'c1', created_by: 'u1', name: 'Internet NBN', amount: 8550, end_date: '2027-01-01' });
  });

  it('clears contract dates on a one-off but keeps its date and provider', () => {
    const item = cost();
    const row = costRowFromForm({ ...costFormFrom(item), cadence: 'one_off' }, { item, groupId: 'g1', fresh });
    expect(row.end_date).toBeNull();
    expect(row.discount_end_date).toBeNull();
    expect(row.start_date).toBe('2026-01-01');
    expect(row.provider).toBe('Aussie');
  });

  it('dates a new undated cost today, but lets an edit clear its date', () => {
    const blank = { ...costFormFrom(undefined), name: 'Couch', amount: 500 };
    const made = costRowFromForm(blank, { item: undefined, groupId: 'g1', fresh, today: '2026-10-23' });
    expect(made).toMatchObject({ id: 'new1', group_id: 'g1', start_date: '2026-10-23', created_by: 'u1', deleted: false });
    const item = cost();
    expect(costRowFromForm({ ...costFormFrom(item), start_date: '' }, { item, groupId: 'g1', fresh }).start_date).toBeNull();
  });

  it('adds a price change only to a recurring cost with a date and amount', () => {
    const item = cost();
    const form = costFormFrom(item);
    const changed = costRowFromForm(form, { item, groupId: 'g1', fresh, priceChange: { from: '2026-11-01', dollars: 90 } });
    expect(changed.price_changes).toEqual([{ from: '2026-11-01', amount: 9000 }]);
    expect(costRowFromForm(form, { item, groupId: 'g1', fresh, priceChange: { from: '', dollars: 90 } }).price_changes).toBeUndefined();
    expect(
      costRowFromForm({ ...form, cadence: 'one_off' }, { item, groupId: 'g1', fresh, priceChange: { from: '2026-11-01', dollars: 90 } }).price_changes
    ).toBeUndefined();
  });
});

describe('costNeedsReminderSync', () => {
  it('runs when the cost has or had an expiry date', () => {
    expect(costNeedsReminderSync(cost(), undefined)).toBe(true);
    expect(costNeedsReminderSync(cost({ end_date: null, discount_end_date: null }), cost())).toBe(true);
    expect(costNeedsReminderSync(cost({ end_date: null, discount_end_date: null }), undefined)).toBe(false);
  });
});

describe('newCostLine', () => {
  const opts = { id: 'n1', groupId: 'g1', createdBy: 'u1', today: '2026-10-23' };

  it('dates only a one-off actual', () => {
    expect(newCostLine({ name: 'Couch', category: 'purchase', amount: 50000, cadence: 'one_off' }, opts).start_date).toBe('2026-10-23');
    expect(newCostLine(rentCostLine(60000), opts)).toMatchObject({ start_date: null, cadence: 'weekly', linked_section: 'home_search' });
    expect(newCostLine(setupCostLine(250000), opts)).toMatchObject({ start_date: null, is_estimate: true, linked_section: 'home_setup' });
  });
});
