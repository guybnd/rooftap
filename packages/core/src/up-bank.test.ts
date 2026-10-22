import { describe, expect, it } from 'vitest';
import type { CostItem } from './types';
import {
  bankDayLabel,
  bankTransactionView,
  groupByDay,
  bankMatchFits,
  bankNudges,
  bankPayees,
  costBankLinks,
  linkedCostItem,
  monthRange,
  normaliseBankMatch,
  summariseAccounts,
  upAccountRow,
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
  it('keeps Up tags and raw text that differs from the description', () => {
    const t = upTx();
    t.relationships.tags = { data: [{ id: 'rent' }, { id: 'Holiday' }] };
    t.attributes.rawText = 'GUZMAN Y GOMEZ NEWTOWN AU';
    const r = upTransactionRow(t, { groupId: 'g', userId: 'u' }, new Map());
    expect(r.tags).toEqual(['rent', 'Holiday']);
    expect(r.raw_text).toBe('GUZMAN Y GOMEZ NEWTOWN AU');
  });
});

describe('link rules', () => {
  const pay = (over: Partial<BankTransaction>) => row({ amount_cents: -245000, ...over });
  it('matches a payee name inside the description or raw text, ignoring case and spacing', () => {
    expect(bankMatchFits('ray white', pay({ description: 'RAY  WHITE NEWTOWN' }))).toBe(true);
    expect(bankMatchFits('ray white', pay({ description: 'Transfer', raw_text: 'Ray White Newtown' }))).toBe(true);
    expect(bankMatchFits('ray white', pay({ description: 'Coles' }))).toBe(false);
  });
  it('matches an Up tag with #', () => {
    expect(bankMatchFits('#Rent', pay({ description: 'Anyone', tags: ['rent'] }))).toBe(true);
    expect(bankMatchFits('#rent', pay({ description: 'Rent', tags: [] }))).toBe(false);
  });
  it('tidies a typed match', () => {
    expect(normaliseBankMatch('  Ray   White ')).toBe('Ray White');
    expect(normaliseBankMatch('# rent')).toBe('#rent');
    expect(normaliseBankMatch('#')).toBeNull();
    expect(normaliseBankMatch('a')).toBeNull();
  });
  it('links money out to the first rule that fits, and leaves hand links alone', () => {
    const rules = [
      { cost_item_id: 'rent', match: 'RAY WHITE' },
      { cost_item_id: 'other', match: 'RAY' },
    ];
    expect(linkedCostItem(pay({ description: 'Ray White' }), rules)).toBe('rent');
    expect(linkedCostItem(pay({ description: 'Ray White', amount_cents: 500 }), rules)).toBeNull();
    expect(linkedCostItem(pay({ description: 'Ray White', is_transfer: true }), rules)).toBeNull();
    expect(linkedCostItem(pay({ description: 'Ray White', cost_item_id: 'mine', link_kind: 'manual' }), rules)).toBe('mine');
    expect(linkedCostItem(pay({ description: 'Coles', cost_item_id: 'rent', link_kind: 'rule' }), rules)).toBeNull();
  });
});

describe('costBankLinks and bankNudges', () => {
  const rules = [{ cost_item_id: 'rent', match: 'RAY WHITE', keep_amount: false }];
  const rows = [
    row({ external_id: 'a', cost_item_id: 'rent', amount_cents: -240000, occurred_at: '2026-09-01T00:00:00Z' }),
    row({ external_id: 'b', cost_item_id: 'rent', amount_cents: -245000, occurred_at: '2026-10-01T00:00:00Z' }),
    row({ external_id: 'b', user_id: 'u2', cost_item_id: 'rent', amount_cents: -245000, occurred_at: '2026-10-01T00:00:00Z' }),
    row({ external_id: 'c', cost_item_id: 'rent', amount_cents: -1, hidden: true, occurred_at: '2026-10-05T00:00:00Z' }),
  ];
  it('reads the latest settled payment once per Up transaction', () => {
    expect(costBankLinks(rows, rules)).toEqual([
      { costItemId: 'rent', match: 'RAY WHITE', keepAmount: false, count: 2, lastPaidAt: '2026-10-01T00:00:00Z', lastAmountCents: 245000 },
    ]);
  });
  it('nudges a recurring line whose latest payment differs', () => {
    const item = { id: 'rent', amount: 240000, cadence: 'monthly' } as CostItem;
    const links = costBankLinks(rows, rules);
    expect(bankNudges([item], links)).toEqual([{ item, paidCents: 245000, paidAt: '2026-10-01T00:00:00Z' }]);
    expect(bankNudges([{ ...item, amount: 245000 }], links)).toEqual([]);
    expect(bankNudges([{ ...item, cadence: 'one_off' }], links)).toEqual([]);
    expect(bankNudges([item], [{ ...links[0], keepAmount: true }])).toEqual([]);
  });
});

describe('bankPayees', () => {
  it('puts payees in a fitting Up category first, then the most frequent, with tags', () => {
    const rows = [
      row({ external_id: '1', description: 'Coles', category: 'groceries', occurred_at: '2026-10-03T00:00:00Z' }),
      row({ external_id: '2', description: 'Coles', category: 'groceries', occurred_at: '2026-10-02T00:00:00Z' }),
      row({ external_id: '3', description: 'Ray White', category: 'rent-and-mortgage', tags: ['rent'], amount_cents: -245000, occurred_at: '2026-10-01T00:00:00Z' }),
      row({ external_id: '4', description: 'Pay', amount_cents: 400000 }),
    ];
    const payees = bankPayees(rows, { category: 'rent' });
    expect(payees.map((p) => p.match)).toEqual(['Ray White', '#rent', 'Coles']);
    expect(payees[2]).toMatchObject({ count: 2, lastAmountCents: 1000, suggested: false });
    expect(bankPayees(rows, { query: 'col' }).map((p) => p.match)).toEqual(['Coles']);
  });
});

describe('summariseAccounts', () => {
  it('totals everyday and saver balances, counting a joint account once and leaving home loans out', () => {
    const owner = { groupId: 'g', userId: 'u1' };
    const acc = (id: string, type: string, cents: number, ownership = 'INDIVIDUAL') =>
      upAccountRow({ id, attributes: { displayName: id, accountType: type, ownershipType: ownership, balance: { currencyCode: 'AUD', valueInBaseUnits: cents } } }, owner);
    const joint = acc('2up', 'TRANSACTIONAL', 64000, 'JOINT');
    const out = summariseAccounts([
      acc('spending', 'TRANSACTIONAL', 128410),
      joint,
      { ...joint, user_id: 'u2' },
      acc('holiday', 'SAVER', 630000),
      acc('loan', 'HOME_LOAN', -50000000),
    ]);
    expect(out.everydayCents).toBe(192410);
    expect(out.saversCents).toBe(630000);
    expect(out.accounts.map((a) => a.id)).toEqual(['spending', '2up', 'holiday']);
    expect(out.accounts[1].joint).toBe(true);
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

describe('Money view helpers', () => {
  it('labels days relative to now', () => {
    const now = new Date(2026, 9, 22, 12);
    expect(bankDayLabel(new Date(2026, 9, 22, 8).toISOString(), now)).toBe('Today');
    expect(bankDayLabel(new Date(2026, 9, 21, 23).toISOString(), now)).toBe('Yesterday');
    expect(bankDayLabel(new Date(2026, 9, 3, 9).toISOString(), now)).toMatch(/^3 Oct$/);
    expect(bankDayLabel(new Date(2025, 9, 3, 9).toISOString(), now)).toMatch(/2025$/);
  });
  it('groups a newest-first list by day', () => {
    const now = new Date(2026, 9, 22, 12);
    const at = (d: number, h: number) => ({ occurredAt: new Date(2026, 9, d, h).toISOString() });
    const groups = groupByDay([at(22, 9), at(22, 8), at(21, 20), at(3, 1)], now);
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      [expect.stringMatching(/3 Oct/), 1],
    ]);
  });
  it('marks whether the viewer owns a transaction and carries its edits', () => {
    const r = row({ user_id: 'u1', note: 'bond', hidden: true, cost_item_id: 'rent', link_kind: 'manual', tags: ['rent'] });
    expect(bankTransactionView(r, 'u1')).toMatchObject({ mine: true, note: 'bond', hidden: true, costItemId: 'rent', linkKind: 'manual', tags: ['rent'] });
    expect(bankTransactionView(r, 'u2').mine).toBe(false);
  });
});
