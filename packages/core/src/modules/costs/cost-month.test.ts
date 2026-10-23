import { describe, expect, it } from 'vitest';
import { costMonth, costPriceOn, type LedgerRow } from './cost-month';
import type { CostItem } from '../../types';

function cost(overrides: Partial<CostItem>): CostItem {
  return {
    id: 'id',
    group_id: 'g',
    name: 'Cost',
    category: 'other',
    amount: 10_000,
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
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

function row(overrides: Partial<LedgerRow>): LedgerRow {
  return {
    month: '2026-10',
    vendor: 'Shop',
    costItemId: null,
    sourceCategory: null,
    outCents: 0,
    inCents: 0,
    count: 1,
    lastAt: '2026-10-10T01:00:00.000Z',
    source: 'up',
    ...overrides,
  };
}

const now = new Date(2026, 9, 22); // 22 Oct 2026

describe('costMonth', () => {
  const internet = cost({ id: 'net', name: 'Internet', category: 'internet', amount: 8_500, cadence: 'monthly', start_date: '2026-06-28' });
  const coles = cost({ id: 'coles', name: 'Coles', category: 'grocery_estimate', amount: 23_600, bank_source: 'up', is_estimate: true, start_date: '2026-10-21' });
  const ledger = [
    row({ vendor: 'Coles', costItemId: 'coles', outCents: 46_200, count: 5, lastAt: '2026-10-21T02:00:00.000Z' }),
    row({ vendor: 'Aussie Broadband', costItemId: 'net', month: '2026-09', outCents: 8_500, lastAt: '2026-09-28T02:00:00.000Z' }),
    row({ vendor: 'Coles', costItemId: 'coles', month: '2026-09', outCents: 60_000, count: 6 }),
  ];

  it("sums a shop's payments and never counts the shop line's own amount", () => {
    const m = costMonth({ items: [coles], ledger, month: '2026-10', now });
    const groceries = m.categories.find((c) => c.category === 'grocery_estimate')!;
    const shop = groceries.lines.find((l) => l.kind === 'shop')!;
    expect(shop).toMatchObject({ name: 'Coles', paidCents: 46_200, count: 5, source: 'up' });
    expect(groceries.paidCents).toBe(46_200);
  });

  it("shows a bill the bank pays as due when this month's payment hasn't come out, never last month's", () => {
    const m = costMonth({ items: [internet, coles], ledger, month: '2026-10', now });
    const line = m.categories.find((c) => c.category === 'internet')!.lines[0];
    expect(line).toMatchObject({ kind: 'recurring', paidCents: 0, toComeCents: 8_500, date: '2026-10-28' });
    const sep = costMonth({ items: [internet, coles], ledger, month: '2026-09', now });
    expect(sep.categories.find((c) => c.category === 'internet')!.lines[0]).toMatchObject({ paidCents: 8_500, toComeCents: 0 });
  });

  it("adds what's left of a category's usual shop spend in the current month only", () => {
    const m = costMonth({ items: [coles], ledger, month: '2026-10', now });
    const usual = m.categories.find((c) => c.category === 'grocery_estimate')!.lines.find((l) => l.kind === 'usual')!;
    // Sep only (weight 3 of 6 counted months): 60,000 * 3 / 6 = 30,000, less 46,200 paid: nothing left.
    expect(usual).toBeUndefined();
    const nov = costMonth({ items: [coles], ledger, month: '2026-11', now });
    expect(nov.toComeCents).toBe(30_000);
    expect(costMonth({ items: [coles], ledger, month: '2026-09', now }).toComeCents).toBe(0);
  });

  it('counts a cost added by hand once its date has passed, and later dates as to come', () => {
    const gym = cost({ id: 'gym', name: 'Gym', category: 'health', amount: 5_000, cadence: 'fortnightly', start_date: '2026-10-06' });
    const m = costMonth({ items: [gym], ledger: [], month: '2026-10', now });
    expect(m.paidCents).toBe(10_000); // Oct 6, Oct 20
    expect(m.toComeCents).toBe(0);
    const nov = costMonth({ items: [gym], ledger: [], month: '2026-11', now });
    expect(nov.toComeCents).toBe(10_000); // Nov 3, Nov 17
  });

  it('leaves archived costs out but still counts the payments filed under them', () => {
    const old = cost({ id: 'old', name: 'Old plan', category: 'utilities', amount: 9_000, cadence: 'monthly', start_date: '2026-10-01', archived: true });
    const paidToOld = row({ vendor: 'Power Co', costItemId: 'old', outCents: 12_000 });
    const m = costMonth({ items: [old], ledger: [paidToOld], month: '2026-10', now });
    expect(m.paidCents).toBe(12_000);
    expect(m.toComeCents).toBe(0);
  });

  it('takes a price change from its date on', () => {
    const net = { ...internet, price_changes: [{ from: '2026-11-01', amount: 9_000 }] };
    expect(costPriceOn(net, new Date(2026, 9, 28))).toBe(8_500);
    expect(costPriceOn(net, new Date(2026, 10, 28))).toBe(9_000);
    const dec = costMonth({ items: [net], ledger: [], month: '2026-12', now });
    expect(dec.toComeCents).toBe(9_000);
  });

  it('keeps money in apart: pay is income, a refund from a known shop takes its category down', () => {
    const m = costMonth({
      items: [coles],
      ledger: [
        ...ledger,
        row({ vendor: 'Coles', inCents: 4_000, count: 0 }),
        row({ vendor: 'ACME Payroll', inCents: 550_000, count: 0 }),
      ],
      month: '2026-10',
      now,
    });
    expect(m.categories.find((c) => c.category === 'grocery_estimate')!.paidCents).toBe(42_200);
    expect(m.incomeCents).toBe(550_000);
    expect(m.income!.lines[0].name).toBe('ACME Payroll');
    expect(m.categories.some((c) => c.category === 'income')).toBe(false);
  });

  it('counts an Income cost added by hand as income, not spending', () => {
    const salary = cost({ id: 'pay', name: 'Salary', category: 'income', amount: 600_000, cadence: 'monthly', start_date: '2026-06-15' });
    const m = costMonth({ items: [salary], ledger: [], month: '2026-10', now });
    expect(m.paidCents).toBe(0);
    expect(m.incomeCents).toBe(600_000);
    expect(m.incomeExpectedCents).toBe(600_000);
  });

  it('expects income only from regular payers, never from a one-off lump sum', () => {
    const m = costMonth({
      items: [],
      ledger: [
        row({ month: '2026-08', vendor: 'ACME Payroll', inCents: 500_000 }),
        row({ month: '2026-09', vendor: 'ACME Payroll', inCents: 520_000 }),
        row({ month: '2026-09', vendor: 'Savings move', inCents: 2_500_000 }),
        row({ month: '2026-10', vendor: 'ACME Payroll', inCents: 200_000 }),
      ],
      month: '2026-10',
      now,
    });
    expect(m.incomeCents).toBe(200_000);
    // Median of 500,000 and 520,000 is 510,000, less 200,000 already in.
    expect(m.incomeExpectedCents).toBe(510_000);
  });

  it("falls back to the bank's category when a payment's cost line is gone", () => {
    const m = costMonth({ items: [], ledger: [row({ vendor: 'Thieves Coffee', costItemId: 'deleted-line', sourceCategory: 'restaurants-and-cafes', outCents: 3_800 })], month: '2026-10', now });
    expect(m.categories.map((c) => c.category)).toEqual(['outing']);
  });

  it('puts payments with no category in their own group first', () => {
    const m = costMonth({ items: [coles], ledger: [...ledger, row({ vendor: 'Mystery', outCents: 1_000 })], month: '2026-10', now });
    expect(m.categories[0].category).toBeNull();
  });

  it("files a payment moved on its own under its pick, outside its bill", () => {
    const m = costMonth({ items: [internet, coles], ledger: [row({ vendor: 'Aussie Broadband', costItemId: 'net', category: 'insurance', outCents: 2_000 })], month: '2026-10', now });
    const ins = m.categories.find((c) => c.category === 'insurance')!;
    expect(ins.lines[0]).toMatchObject({ kind: 'shop', name: 'Aussie Broadband', paidCents: 2_000 });
    expect(m.categories.find((c) => c.category === 'internet')!.lines[0]).toMatchObject({ kind: 'recurring', paidCents: 0 });
  });
});
