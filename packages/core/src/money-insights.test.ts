import { describe, expect, it } from 'vitest';
import {
  bankActualsOf,
  billsDue,
  isBill,
  monthForecast,
  moneyNudgeCopy,
  moneyNudges,
  nextDue,
  relativeDay,
  weeklyMoneyDigest,
} from './money-insights';
import type { BankTransaction, CostBankLink } from './up-bank';
import type { CostItem } from './types';

const NOW = new Date(2026, 9, 22, 12); // Thu 22 Oct 2026, local time

function line(o: Partial<CostItem> & Pick<CostItem, 'id' | 'name'>): CostItem {
  return {
    group_id: 'g',
    category: 'subscription',
    amount: 1000,
    cadence: 'monthly',
    is_estimate: false,
    start_date: '2026-01-05',
    end_date: null,
    discount_end_date: null,
    provider: null,
    assigned_to: null,
    linked_section: null,
    notes: null,
    sort_order: 0,
    created_by: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted: false,
    ...o,
  };
}

function link(o: Partial<CostBankLink> & Pick<CostBankLink, 'costItemId'>): CostBankLink {
  return { match: 'X', keepAmount: true, count: 2, lastPaidAt: null, lastAmountCents: null, ...o };
}

function pay(o: Partial<BankTransaction> & Pick<BankTransaction, 'external_id' | 'amount_cents' | 'occurred_at'>): BankTransaction {
  return {
    id: o.external_id,
    group_id: 'g',
    user_id: 'u1',
    source: 'up',
    account_name: 'Joint',
    description: 'Shop',
    message: null,
    currency: 'AUD',
    category: null,
    parent_category: null,
    status: 'SETTLED',
    is_transfer: false,
    settled_at: null,
    ...o,
  } as BankTransaction;
}

const local = (y: number, m: number, d: number) => new Date(y, m - 1, d, 9).toISOString();

describe('isBill', () => {
  it('counts fixed lines and estimates in bill categories, not other estimates or one-offs', () => {
    expect(isBill(line({ id: 'a', name: 'Netflix' }))).toBe(true);
    expect(isBill(line({ id: 'b', name: 'Power', category: 'utilities', is_estimate: true }))).toBe(true);
    expect(isBill(line({ id: 'c', name: 'Food', category: 'grocery_estimate', is_estimate: true }))).toBe(false);
    expect(isBill(line({ id: 'd', name: 'Sofa', cadence: 'one_off' }))).toBe(false);
    expect(isBill(line({ id: 'e', name: 'Gone', deleted: true }))).toBe(false);
  });
});

describe('nextDue and billsDue', () => {
  it('steps a cadence from the last payment', () => {
    const due = nextDue(line({ id: 'a', name: 'Netflix' }), local(2026, 10, 1), NOW);
    expect(due?.getMonth()).toBe(10);
    expect(due?.getDate()).toBe(1);
  });

  it('lists bills in the window, soonest first, and leaves out spending estimates', () => {
    const items = [
      line({ id: 'rent', name: 'Rent', amount: 240000, start_date: '2026-01-24' }),
      line({ id: 'net', name: 'Internet', amount: 8900, start_date: '2026-01-23' }),
      line({ id: 'food', name: 'Groceries', category: 'grocery_estimate', is_estimate: true, start_date: '2026-01-23' }),
      line({ id: 'far', name: 'Insurance', start_date: '2026-01-15' }),
    ];
    const bills = billsDue(items, [], NOW, 7);
    expect(bills.map((b) => b.item.id)).toEqual(['net', 'rent']);
    expect(bills[1].amountCents).toBe(240000);
  });
});

describe('monthForecast', () => {
  it('adds spending no line holds to the plan, and is at least what was spent', () => {
    const items = [line({ id: 'rent', name: 'Rent', amount: 200000, start_date: '2026-01-01' })];
    const bank = bankActualsOf([{ costItemId: 'rent', month: '2026-10', cents: 200000 }], [], null);
    const f = monthForecast(items, bank, 260000, NOW);
    expect(f.forecastCents).toBe(260000);
    expect(f.toComeCents).toBe(0);
    const g = monthForecast(items, undefined, 50000, NOW);
    expect(g.forecastCents).toBeGreaterThanOrEqual(200000);
    expect(g.toComeCents).toBe(g.forecastCents - 50000);
  });
});

describe('moneyNudges', () => {
  it('flags a price change with its yearly cost', () => {
    const items = [line({ id: 'nf', name: 'Netflix', amount: 2599 })];
    const links = [link({ costItemId: 'nf', lastPaidAt: local(2026, 10, 10), lastAmountCents: 2599, prevAmountCents: 2299 })];
    const [n] = moneyNudges({ items, links, now: NOW });
    expect(n.kind).toBe('price');
    const copy = moneyNudgeCopy(n, NOW);
    expect(copy.title).toBe('Netflix went up');
    expect(copy.figure).toEqual({ text: '+$36 a year', tone: 'warning' });
  });

  it('flags a bill that has not come out, ahead of a price change', () => {
    const items = [line({ id: 'nf', name: 'Netflix', amount: 2599 }), line({ id: 'p', name: 'Power', amount: 30000 })];
    const links = [
      link({ costItemId: 'nf', lastPaidAt: local(2026, 10, 10), lastAmountCents: 2599, prevAmountCents: 2299 }),
      link({ costItemId: 'p', lastPaidAt: local(2026, 9, 10), lastAmountCents: 30000 }),
    ];
    expect(moneyNudges({ items, links, now: NOW }).map((n) => n.kind)).toEqual(['missing', 'price']);
  });

  it('offers to update a hand-made line its payments no longer match', () => {
    const items = [line({ id: 'g', name: 'Gym', amount: 5000 })];
    const links = [link({ costItemId: 'g', keepAmount: false, lastPaidAt: local(2026, 10, 15), lastAmountCents: 5500 })];
    const [n] = moneyNudges({ items, links, now: NOW });
    expect(n).toMatchObject({ kind: 'differs', paidCents: 5500 });
  });

  it('warns when the joint account is short for the week of bills', () => {
    const items = [line({ id: 'rent', name: 'Rent', amount: 240000, start_date: '2026-01-24' })];
    const accounts = [{ id: 'j', name: 'Joint', type: 'TRANSACTIONAL', joint: true, balanceCents: 100000 }];
    const [n] = moneyNudges({ items, links: [], accounts: accounts as never, now: NOW });
    expect(n).toMatchObject({ kind: 'short', billsCents: 240000, balanceCents: 100000 });
    expect(moneyNudgeCopy(n, NOW).figure?.text).toBe('$1,400 short');
  });

  it('flags a category running ahead of its usual pace', () => {
    const items = [line({ id: 'f', name: 'Groceries', category: 'grocery_estimate', is_estimate: true, amount: 80000 })];
    const bank = bankActualsOf(
      [
        { costItemId: 'f', month: '2026-07', cents: 80000 },
        { costItemId: 'f', month: '2026-08', cents: 80000 },
        { costItemId: 'f', month: '2026-09', cents: 80000 },
        { costItemId: 'f', month: '2026-10', cents: 90000 },
      ],
      [],
      '2026-07',
    );
    const [n] = moneyNudges({ items, links: [], bank, now: NOW });
    expect(n).toMatchObject({ kind: 'ahead', category: 'grocery_estimate', paidCents: 90000 });
  });
});

describe('relativeDay', () => {
  it('names nearby days', () => {
    expect(relativeDay(new Date(2026, 9, 23), NOW)).toBe('tomorrow');
    expect(relativeDay(new Date(2026, 9, 19), NOW)).toBe('3 days ago');
  });
});

describe('weeklyMoneyDigest', () => {
  it('sums the week once per payment and names the top payees', () => {
    const week = [
      pay({ external_id: 'a', amount_cents: -18400, occurred_at: local(2026, 10, 20), description: 'Woolworths' }),
      pay({ external_id: 'a', amount_cents: -18400, occurred_at: local(2026, 10, 20), description: 'Woolworths', user_id: 'u2' }),
      pay({ external_id: 'b', amount_cents: -15600, occurred_at: local(2026, 10, 19), description: 'Origin Energy' }),
      pay({ external_id: 'c', amount_cents: -5000, occurred_at: local(2026, 10, 18), description: 'Saver', is_transfer: true }),
      pay({ external_id: 'd', amount_cents: 300000, occurred_at: local(2026, 10, 18), description: 'Pay' }),
    ];
    const text = weeklyMoneyDigest({ items: [], links: [], week, monthSpentCents: 34000, now: NOW })!;
    expect(text).toContain('$340 spent from shared accounts. Most went to Woolworths ($184) and Origin Energy ($156).');
    expect(text).toContain('October is on track for $340');
    expect(text).not.toMatch(/—/);
  });

  it('lists bills and nudges, and says nothing when there is nothing to say', () => {
    const items = [line({ id: 'rent', name: 'Rent', amount: 240000, start_date: '2026-01-24' })];
    const text = weeklyMoneyDigest({ items, links: [], week: [], monthSpentCents: 0, now: NOW })!;
    expect(text).toContain('Bills in the next 7 days:\n- Rent, $2,400, in 2 days');
    expect(weeklyMoneyDigest({ items: [], links: [], week: [], monthSpentCents: 0, now: NOW })).toBeNull();
  });
});
