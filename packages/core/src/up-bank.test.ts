import { describe, expect, it } from 'vitest';
import {
  monthRange,
  summariseSpending,
  upCategoryLabel,
  upTokenLooksValid,
  upTransactionRow,
  type BankTransaction,
  type UpTransactionResource,
} from './up-bank';

function upTx(over: Partial<{ id: string; cents: number; category: string | null; transfer: boolean; status: 'HELD' | 'SETTLED' }> = {}): UpTransactionResource {
  return {
    id: over.id ?? 'tx-1',
    attributes: {
      status: over.status ?? 'SETTLED',
      description: ' Guzman y Gomez ',
      message: '',
      amount: { currencyCode: 'AUD', valueInBaseUnits: over.cents ?? -1850 },
      settledAt: '2026-10-03T02:00:00+10:00',
      createdAt: '2026-10-02T19:30:00+10:00',
    },
    relationships: {
      account: { data: { id: 'acc-1' } },
      transferAccount: { data: over.transfer ? { id: 'acc-2' } : null },
      category: { data: over.category === null ? null : { id: over.category ?? 'takeaway' } },
      parentCategory: { data: { id: 'good-life' } },
    },
  };
}

function row(over: Partial<BankTransaction>): BankTransaction {
  return {
    id: over.external_id ?? 'r',
    group_id: 'g',
    user_id: 'u1',
    source: 'up',
    external_id: 'x',
    account_name: 'Spending',
    description: 'Shop',
    message: null,
    amount_cents: -1000,
    currency: 'AUD',
    category: 'groceries',
    parent_category: 'home',
    status: 'SETTLED',
    is_transfer: false,
    occurred_at: '2026-10-05T00:00:00Z',
    settled_at: null,
    ...over,
  };
}

describe('upTokenLooksValid', () => {
  it('takes an Up personal access token', () => {
    expect(upTokenLooksValid(' up:yeah:abcdefghijklmnopqrstuvwxyz0123 ')).toBe(true);
  });
  it('refuses anything else', () => {
    expect(upTokenLooksValid('abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(upTokenLooksValid('up:yeah:short')).toBe(false);
    expect(upTokenLooksValid('up:yeah:abcdefghij klmnopqrstuvwxyz')).toBe(false);
    expect(upTokenLooksValid(null)).toBe(false);
  });
});

describe('upCategoryLabel', () => {
  it('turns Up ids into words', () => {
    expect(upCategoryLabel('restaurants-and-cafes')).toBe('Restaurants and cafes');
    expect(upCategoryLabel('tv-and-music')).toBe('TV and music');
    expect(upCategoryLabel(null)).toBeNull();
  });
});

describe('upTransactionRow', () => {
  it('maps an Up transaction to a stored row', () => {
    const r = upTransactionRow(upTx(), { groupId: 'g', userId: 'u' }, new Map([['acc-1', 'Spending']]));
    expect(r).toMatchObject({
      group_id: 'g',
      user_id: 'u',
      source: 'up',
      external_id: 'tx-1',
      account_name: 'Spending',
      description: 'Guzman y Gomez',
      message: null,
      amount_cents: -1850,
      currency: 'AUD',
      category: 'takeaway',
      parent_category: 'good-life',
      status: 'SETTLED',
      is_transfer: false,
    });
  });
  it('marks transfers between own accounts', () => {
    expect(upTransactionRow(upTx({ transfer: true }), { groupId: 'g', userId: 'u' }, new Map()).is_transfer).toBe(true);
  });
});

describe('summariseSpending', () => {
  it('totals money out and in, without transfers, by category', () => {
    const s = summariseSpending(
      [
        row({ external_id: 'a', amount_cents: -2000, category: 'groceries' }),
        row({ external_id: 'b', amount_cents: -500, category: 'takeaway', occurred_at: '2026-10-06T00:00:00Z' }),
        row({ external_id: 'c', amount_cents: -1500, category: 'groceries' }),
        row({ external_id: 'd', amount_cents: 300000, category: null }),
        row({ external_id: 'e', amount_cents: -10000, is_transfer: true }),
        row({ external_id: 'f', amount_cents: -700, category: null, parent_category: null }),
      ],
      '2026-10-01',
    );
    expect(s.spentCents).toBe(4700);
    expect(s.receivedCents).toBe(300000);
    expect(s.categories.map((c) => [c.label, c.cents])).toEqual([
      ['Groceries', 3500],
      ['Uncategorised', 700],
      ['Takeaway', 500],
    ]);
    expect(s.recent[0].description).toBe('Shop');
    expect(s.recent.some((t) => t.id === 'e')).toBe(false);
  });

  it('counts a joint account transaction once when two people connected it', () => {
    const s = summariseSpending(
      [row({ id: '1', external_id: 'same', user_id: 'u1' }), row({ id: '2', external_id: 'same', user_id: 'u2' })],
      '2026-10-01',
    );
    expect(s.spentCents).toBe(1000);
    expect(s.recent).toHaveLength(1);
  });
});

describe('monthRange', () => {
  it('runs from the first of the month to the first of the next', () => {
    const r = monthRange('2026-12-01')!;
    expect(r.from.getMonth()).toBe(11);
    expect(r.to.getFullYear()).toBe(2027);
    expect(r.to.getMonth()).toBe(0);
  });
  it('refuses a non-month', () => {
    expect(monthRange('2026-13')).toBeNull();
    expect(monthRange('soon')).toBeNull();
  });
});
