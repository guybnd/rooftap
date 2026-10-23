import { describe, expect, it } from 'vitest';
import { paymentCategory, paymentGoes } from './month-spending';
import type { CostItem } from './types';

function line(overrides: Partial<CostItem>): CostItem {
  return {
    id: 'x',
    group_id: 'g',
    name: 'Line',
    category: 'other',
    amount: 1_000,
    cadence: 'one_off',
    is_estimate: false,
    start_date: null,
    end_date: null,
    discount_end_date: null,
    provider: null,
    assigned_to: null,
    linked_section: null,
    notes: null,
    sort_order: 0,
    created_by: null,
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

function pay(id: string, cents: number, extra: { category?: string | null; costItemId?: string | null; isTransfer?: boolean; hidden?: boolean } = {}) {
  return { id, amountCents: cents, category: extra.category ?? null, costItemId: extra.costItemId ?? null, isTransfer: !!extra.isTransfer, hidden: !!extra.hidden };
}

describe('payment categories', () => {
  const items = new Map([['coles', line({ id: 'coles', category: 'grocery_estimate' })]]);

  it("takes the cost line's category, then Up's, else none", () => {
    expect(paymentCategory(pay('a', -100, { costItemId: 'coles', category: 'restaurants-and-cafes' }), items)).toBe('grocery_estimate');
    expect(paymentCategory(pay('b', -100, { category: 'restaurants-and-cafes' }), items)).toBe('outing');
    expect(paymentCategory(pay('c', -100), items)).toBeNull();
  });


  it('filters money in and out', () => {
    expect(paymentGoes(pay('a', -1), 'out')).toBe(true);
    expect(paymentGoes(pay('a', -1), 'in')).toBe(false);
    expect(paymentGoes(pay('a', 1), 'in')).toBe(true);
    expect(paymentGoes(pay('a', 1), 'all')).toBe(true);
  });
});
