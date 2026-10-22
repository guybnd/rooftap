import { describe, expect, it } from 'vitest';
import { monthBook, monthOutlook, paymentCategory, paymentGoes, spendingByCategory, stillToCome } from './month-spending';
import type { BankActuals } from './costs';
import type { CostBankLink } from './up-bank';
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

  it('adds up spending by category, biggest first, and payments with no category last', () => {
    const rows = [
      pay('a', -5_000, { costItemId: 'coles' }),
      pay('b', -900, { category: 'takeaway' }),
      pay('c', -7_800),
      pay('d', -2_000, { category: 'groceries' }),
      pay('e', 100_000),
      pay('f', -50_000, { isTransfer: true }),
      pay('g', -3_000, { category: 'takeaway', hidden: true }),
    ];
    const out = spendingByCategory(rows, items);
    expect(out.map((c) => [c.category, c.cents, c.payments.map((p) => p.id)])).toEqual([
      ['grocery_estimate', 7_000, ['a', 'd']],
      ['outing', 900, ['b']],
      [null, 7_800, ['c']],
    ]);
  });

  it('filters money in and out', () => {
    expect(paymentGoes(pay('a', -1), 'out')).toBe(true);
    expect(paymentGoes(pay('a', -1), 'in')).toBe(false);
    expect(paymentGoes(pay('a', 1), 'in')).toBe(true);
    expect(paymentGoes(pay('a', 1), 'all')).toBe(true);
  });
});

describe('bills still to come', () => {
  const now = new Date(2026, 9, 20, 9);
  const power = line({ id: 'power', name: 'Electricity', category: 'utilities', cadence: 'monthly', amount: 28_000, is_estimate: true, start_date: '2026-06-28' });
  const spotify = line({ id: 'spotify', name: 'Spotify', category: 'subscription', cadence: 'monthly', amount: 2_299, start_date: '2026-01-28' });
  const nyt = line({ id: 'nyt', name: 'NYT', category: 'subscription', cadence: 'monthly', amount: 500, start_date: '2026-01-02' });
  const coles = line({ id: 'coles', name: 'Coles', category: 'grocery_estimate', cadence: 'weekly', amount: 18_000, is_estimate: true, start_date: '2026-10-01' });

  it('lists bills due before the month ends, and drops one paid this month', () => {
    const links: CostBankLink[] = [
      { costItemId: 'nyt', match: 'NYT', keepAmount: false, lastPaidAt: '2026-10-02T01:00:00Z', lastAmountCents: 500, count: 3 } as CostBankLink,
    ];
    expect(stillToCome([power, spotify, nyt, coles], links, now).map((b) => b.item.id)).toEqual(['power', 'spotify']);
  });
});

describe('a month ahead', () => {
  const now = new Date(2026, 9, 20);
  const rent = line({ id: 'rent', name: 'Rent', category: 'rent', cadence: 'monthly', amount: 456_250 });
  const ended = line({ id: 'old', name: 'Old gym', category: 'subscription', cadence: 'monthly', amount: 5_000, end_date: '2026-10-31' });
  const coles = line({ id: 'coles', category: 'grocery_estimate', start_date: '2026-10-18', amount: 9_000, bank_source: 'up' });
  const service = line({ id: 'car', name: 'Car service', category: 'transport', start_date: '2026-11-14', amount: 42_000 });
  const bank: BankActuals = {
    linked: new Set(['coles']),
    byItem: new Map([['coles', new Map([['2026-09', 120_000]])]]),
    since: '2026-09',
  };

  it('adds the bills that repeat, the usual everyday spend and planned one-offs', () => {
    const out = monthOutlook([rent, ended, coles, service], bank, '2026-11', now);
    expect(out.bills.map((b) => b.item.id)).toEqual(['rent']);
    expect(out.everyday).toEqual([{ category: 'grocery_estimate', cents: 120_000 }]);
    expect(out.planned.map((i) => i.id)).toEqual(['car']);
    expect(out.totalCents).toBe(456_250 + 120_000 + 42_000);
  });

  it('has no everyday part without bank data', () => {
    expect(monthOutlook([rent], undefined, '2026-11', now).everyday).toEqual([]);
  });
});

describe('a month as one list', () => {
  const now = new Date(2026, 9, 22, 9);
  const coles = line({ id: 'coles', name: 'Coles', category: 'grocery_estimate', start_date: '2026-10-21', amount: 18_420, bank_source: 'up', is_estimate: true });
  const power = line({ id: 'power', name: 'Electricity', category: 'utilities', cadence: 'monthly', amount: 28_100, start_date: '2026-06-28', bank_source: 'up' });
  const internet = line({ id: 'net', name: 'Internet', category: 'internet', cadence: 'monthly', amount: 8_500, start_date: '2026-01-15' });
  const google = line({ id: 'g1', name: 'Google One', category: 'subscription', cadence: 'monthly', amount: 1_499, start_date: '2026-01-09', is_estimate: true });
  const items = [coles, power, internet, google];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const bank: BankActuals = {
    linked: new Set(['coles', 'power']),
    byItem: new Map([['coles', new Map([['2026-09', 120_000], ['2026-10', 18_420]])]]),
    since: '2026-09',
  };
  const rows = [
    { ...pay('a', -18_420, { costItemId: 'coles' }), occurredAt: '2026-10-21T07:00:00Z' },
    { ...pay('b', -7_800), occurredAt: '2026-10-20T07:00:00Z' },
  ];
  const links = [{ costItemId: 'power', match: 'AGL', keepAmount: true, lastPaidAt: '2026-09-28T01:00:00Z', lastAmountCents: 28_100, count: 3 } as CostBankLink];

  it('puts payments, hand-made lines and ghosts under their category', () => {
    const book = monthBook({ rows, items, itemById, links, bank, month: '2026-10', now });
    const by = Object.fromEntries(book.categories.map((c) => [c.category ?? 'none', c]));
    // Groceries: the Coles payment, plus the rest of the usual (Sep only: 1200 - 184.20).
    expect(by.grocery_estimate.entries.map((e) => e.kind)).toEqual(['payment', 'usual']);
    expect(by.grocery_estimate.spentCents).toBe(18_420);
    expect(by.grocery_estimate.expectedCents).toBe(120_000 - 18_420);
    // Electricity is paid by the bank and not out yet: a ghost on its due day.
    expect(by.utilities.entries).toMatchObject([{ kind: 'expected', cents: 28_100 }]);
    expect(by.utilities.entries[0].date?.getDate()).toBe(28);
    // A hand-made fixed line counts on its date; a hand-made estimate is a ghost.
    expect(by.internet.entries).toMatchObject([{ kind: 'line', cents: 8_500 }]);
    expect(by.internet.entries[0].date?.getDate()).toBe(15);
    expect(by.subscription.entries).toMatchObject([{ kind: 'expected', cents: 1_499 }]);
    expect(book.categories[book.categories.length - 1].category).toBeNull();
    expect(book.spentCents).toBe(18_420 + 7_800 + 8_500);
  });

  it('keeps only what happened in a finished month', () => {
    const book = monthBook({ rows: [], items, itemById, links, bank, month: '2026-09', now });
    expect(book.categories.map((c) => c.category)).toEqual(['internet']);
    expect(book.expectedCents).toBe(0);
  });
});
