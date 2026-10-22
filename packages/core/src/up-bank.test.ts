import { describe, expect, it } from 'vitest';
import type { CostItem } from './types';
import {
  addBankMatch,
  actualsSinceOf,
  bankMatchParts,
  bankRowJoint,
  costActuals,
  moneyIn,
  monthKeyAt,
  vendorPlan,
  bankAmountsVary,
  bankLineAmount,
  bankRowVisible,
  bankScopePeople,
  costCategoryFromUp,
  filterBankTransactions,
  guessCadence,
  shiftMonth,
  type BankSharing,
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
      { costItemId: 'rent', match: 'RAY WHITE', keepAmount: false, count: 2, lastPaidAt: '2026-10-01T00:00:00Z', lastAmountCents: 245000, prevAmountCents: 240000 },
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

describe('sharing scopes', () => {
  const s: BankSharing = {
    viewerId: 'guy',
    modes: { guy: 'joint', tegan: 'joint', sam: 'none' },
    joint: { guy: { ids: ['g-2up'], names: ['2Up'] }, tegan: { ids: ['t-2up'], names: ['2Up'] } },
  };
  const at = (user_id: string, account_id: string | null, account_name: string | null = null) => ({ user_id, account_id, account_name });

  it('Household shows only joint accounts when people share joint ones', () => {
    expect(bankRowVisible(at('guy', 'g-2up'), s, 'household')).toBe(true);
    expect(bankRowVisible(at('tegan', 't-2up'), s, 'household')).toBe(true);
    expect(bankRowVisible(at('guy', 'g-spending'), s, 'household')).toBe(false);
    expect(bankRowVisible(at('sam', 's-2up'), s, 'household')).toBe(false);
  });

  it('Mine shows only the viewer\'s personal accounts', () => {
    expect(bankRowVisible(at('guy', 'g-spending'), s, 'mine')).toBe(true);
    expect(bankRowVisible(at('guy', 'g-2up'), s, 'mine')).toBe(false);
    expect(bankRowVisible(at('tegan', 't-spending'), s, 'mine')).toBe(false);
  });

  it('older rows without an account id match joint accounts by name', () => {
    expect(bankRowVisible(at('tegan', null, '2Up'), s, 'household')).toBe(true);
    expect(bankRowVisible(at('tegan', null, 'Spending'), s, 'household')).toBe(false);
  });

  it('narrows the read to the people a scope can include', () => {
    expect(bankScopePeople(s, 'mine')).toEqual(['guy']);
    expect(bankScopePeople(s, 'household').sort()).toEqual(['guy', 'tegan']);
  });
});

describe('making a cost from a payment', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString();

  it('guesses the cadence from the gaps between payments', () => {
    expect(guessCadence([day(0)])).toBe('one_off');
    expect(guessCadence([day(0), day(7), day(14)])).toBe('weekly');
    expect(guessCadence([day(0), day(14), day(28)])).toBe('fortnightly');
    expect(guessCadence([day(0), day(31), day(59), day(90)])).toBe('monthly');
    expect(guessCadence([day(0), day(91), day(182)])).toBe('quarterly');
    expect(guessCadence([day(0), day(365)])).toBe('yearly');
    expect(guessCadence([day(0), day(3), day(50)])).toBe('one_off');
  });

  it('maps Up categories onto cost categories', () => {
    expect(costCategoryFromUp('rent-and-mortgage')).toBe('rent');
    expect(costCategoryFromUp('utilities')).toBe('utilities');
    expect(costCategoryFromUp('takeaway')).toBe('outing');
    expect(costCategoryFromUp(null)).toBe('other');
  });

  it('keeps a fixed line at the latest payment and an estimate at the average of three', () => {
    expect(bankLineAmount([-36800, -41500, -5900, -10000], false)).toBe(36800);
    expect(bankLineAmount([-36800, -41500, -5900, -10000], true)).toBe(28067);
    expect(bankLineAmount([-36800], true)).toBe(36800);
    expect(bankLineAmount([], true)).toBeNull();
  });

  it('treats a payee as variable when amounts differ', () => {
    expect(bankAmountsVary([-36800, -41500, -5900])).toBe(true);
    expect(bankAmountsVary([-2299, -2299, -2299])).toBe(false);
    expect(bankAmountsVary([-2299])).toBe(false);
  });
});

describe('Money view filters', () => {
  const view = (over: Partial<BankTransaction>) => bankTransactionView(row(over), 'guy');

  it('searches payee, note and tags, with or without #', () => {
    const rows = [
      view({ id: 'a', external_id: 'a', description: 'Raveche Realty', tags: ['rent'] }),
      view({ id: 'b', external_id: 'b', description: 'Woolworths', note: 'party food' }),
    ];
    expect(filterBankTransactions(rows, { query: '#rent' }).map((r) => r.id)).toEqual(['a']);
    expect(filterBankTransactions(rows, { query: 'PARTY' }).map((r) => r.id)).toEqual(['b']);
    expect(filterBankTransactions(rows, { query: '' })).toHaveLength(2);
  });

  it('filters by category, uncategorised included', () => {
    const rows = [view({ id: 'a', external_id: 'a', category: 'groceries' }), view({ id: 'b', external_id: 'b', category: null })];
    expect(filterBankTransactions(rows, { category: 'groceries' }).map((r) => r.id)).toEqual(['a']);
    expect(filterBankTransactions(rows, { category: 'uncategorised' }).map((r) => r.id)).toEqual(['b']);
  });

  it('steps months across a year', () => {
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
  });
});

describe('merged and joint-only link rules', () => {
  const pay = (over: Partial<BankTransaction>) => row({ amount_cents: -5000, ...over });
  it('fits any payee a merged rule holds', () => {
    expect(bankMatchParts('Sydney Water | #water')).toEqual(['Sydney Water', '#water']);
    expect(bankMatchFits('Sydney Water | #water', pay({ description: 'SYDNEY WATER CORP' }))).toBe(true);
    expect(bankMatchFits('Sydney Water | #water', pay({ description: 'Anyone', tags: ['Water'] }))).toBe(true);
    expect(bankMatchFits('Sydney Water | #water', pay({ description: 'Coles' }))).toBe(false);
  });
  it('adds a payee once', () => {
    expect(addBankMatch('Sydney Water', 'Hunter Water')).toBe('Sydney Water | Hunter Water');
    expect(addBankMatch('Sydney Water | Hunter Water', 'hunter  water')).toBeNull();
    expect(addBankMatch(null, 'Coles')).toBe('Coles');
  });
  it('keeps a joint-only rule to joint payments', () => {
    const rules = [{ cost_item_id: 'coles', match: 'Coles', joint_only: true }];
    expect(linkedCostItem(pay({ description: 'Coles' }), rules)).toBeNull();
    expect(linkedCostItem(pay({ description: 'Coles' }), rules, true)).toBe('coles');
    expect(linkedCostItem(pay({ description: 'Coles' }), [{ cost_item_id: 'mine', match: 'Coles' }])).toBe('mine');
  });
  it('knows a joint payment by account id, or by name on older rows', () => {
    const sharing = { joint: { u1: { ids: ['acc-2up'], names: ['2Up Spending'] } } };
    expect(bankRowJoint(row({ account_id: 'acc-2up' }), sharing)).toBe(true);
    expect(bankRowJoint(row({ account_id: 'acc-me', account_name: '2Up Spending' }), sharing)).toBe(false);
    expect(bankRowJoint(row({ account_id: null, account_name: '2Up Spending' }), sharing)).toBe(true);
    expect(bankRowJoint(row({ user_id: 'u2', account_id: 'acc-2up' }), sharing)).toBe(false);
  });
});

describe('vendorPlan', () => {
  const now = new Date('2026-10-22T00:00:00Z');
  const p = (cents: number, at: string) => ({ amount_cents: cents, occurred_at: at });
  it('makes one payment a one-off in its month', () => {
    expect(vendorPlan([p(-4500, '2026-09-14T03:00:00Z')], now)).toMatchObject({ cadence: 'one_off', amountCents: 4500, estimate: false });
  });
  it('keeps a regular bill at its latest amount', () => {
    const plan = vendorPlan([p(-6999, '2026-08-01T00:00:00Z'), p(-6999, '2026-09-01T00:00:00Z'), p(-6999, '2026-10-01T00:00:00Z')], now);
    expect(plan).toMatchObject({ cadence: 'monthly', amountCents: 6999, estimate: false });
  });
  it('averages the latest three of a bill that changes', () => {
    const plan = vendorPlan([p(-30000, '2026-07-01T00:00:00Z'), p(-35600, '2026-08-01T00:00:00Z'), p(-32000, '2026-09-01T00:00:00Z'), p(-29000, '2026-10-01T00:00:00Z')], now);
    expect(plan).toMatchObject({ cadence: 'monthly', estimate: true, amountCents: Math.round((35600 + 32000 + 29000) / 3) });
  });
  it('makes irregular shopping a one-off at the latest payment', () => {
    const plan = vendorPlan(
      [p(-10000, '2026-07-01T00:00:00Z'), p(-5000, '2026-08-20T00:00:00Z'), p(-8000, '2026-08-24T00:00:00Z'), p(-12000, '2026-10-10T00:00:00Z')],
      now,
    );
    expect(plan).toMatchObject({ cadence: 'one_off', amountCents: 12000, estimate: false, startDate: '2026-10-10' });
  });
  it('needs similar amounts on a schedule to be regular', () => {
    // Monthly gaps, but amounts all over the place: a shop, not a bill.
    expect(vendorPlan([p(-4000, '2026-08-10T00:00:00Z'), p(-24000, '2026-09-10T00:00:00Z'), p(-9000, '2026-10-10T00:00:00Z')], now)?.cadence).toBe('one_off');
    // Two equal payments a week apart: not enough to call it weekly.
    expect(vendorPlan([p(-17100, '2026-10-01T00:00:00Z'), p(-17100, '2026-10-08T00:00:00Z')], now)?.cadence).toBe('one_off');
    // Three a week apart is.
    expect(vendorPlan([p(-1500, '2026-10-01T00:00:00Z'), p(-1500, '2026-10-08T00:00:00Z'), p(-1500, '2026-10-15T00:00:00Z')], now)?.cadence).toBe('weekly');
  });
  it('stops calling a subscription regular once it is well overdue', () => {
    expect(vendorPlan([p(-2299, '2026-06-01T00:00:00Z'), p(-2299, '2026-07-01T00:00:00Z')], now)?.cadence).toBe('one_off');
  });
  it('ignores money in', () => {
    expect(vendorPlan([p(2000, '2026-10-01T00:00:00Z')], now)).toBeNull();
  });
});

describe('costActuals', () => {
  it('sums each line per device month, once per joint payment, leaving out hidden rows and money in', () => {
    const rows = [
      row({ external_id: 'a', cost_item_id: 'power', amount_cents: -30000, occurred_at: '2026-09-30T15:00:00Z' }),
      row({ external_id: 'a', user_id: 'u2', cost_item_id: 'power', amount_cents: -30000, occurred_at: '2026-09-30T15:00:00Z' }),
      row({ external_id: 'b', cost_item_id: 'power', amount_cents: -5000, occurred_at: '2026-10-05T00:00:00Z', hidden: true }),
      row({ external_id: 'c', cost_item_id: 'power', amount_cents: 1000, occurred_at: '2026-10-06T00:00:00Z' }),
    ];
    // 15:00 UTC on 30 Sep is 1 Oct in Sydney (offset -600).
    expect(costActuals(rows, -600)).toEqual([{ costItemId: 'power', month: '2026-10', cents: 30000 }]);
    expect(costActuals(rows, 0)).toEqual([{ costItemId: 'power', month: '2026-09', cents: 30000 }]);
  });
  it('reads months in the device time zone', () => {
    expect(monthKeyAt('2026-09-30T15:00:00Z', -600)).toBe('2026-10');
    expect(monthKeyAt('2026-09-30T15:00:00Z', 0)).toBe('2026-09');
  });
  it('starts coverage at the first whole month of data', () => {
    expect(actualsSinceOf([{ occurred_at: '2026-07-24T00:00:00Z' }, { occurred_at: '2026-10-01T00:00:00Z' }])).toBe('2026-08');
    expect(actualsSinceOf([{ occurred_at: '2026-07-01T05:00:00Z' }])).toBe('2026-07');
    expect(actualsSinceOf([])).toBeNull();
  });
});

describe('moneyIn', () => {
  const t = (over: Partial<{ description: string; amountCents: number; accountName: string | null; hidden: boolean }>) => ({
    description: 'Pay',
    amountCents: 100000,
    accountName: '2Up Spending',
    hidden: false,
    ...over,
  });
  it('totals money into joint accounts by sender, biggest first', () => {
    const result = moneyIn(
      [
        t({ description: 'Transfer from Guy', amountCents: 150000 }),
        t({ description: 'transfer from guy', amountCents: 150000 }),
        t({ description: 'Refund', amountCents: 2000 }),
        t({ description: 'Salary', amountCents: 400000, accountName: 'Spending' }),
        t({ description: 'Coles', amountCents: -5000 }),
        t({ description: 'Hidden', hidden: true }),
      ],
      ['2Up Spending'],
    );
    expect(result.totalCents).toBe(302000);
    expect(result.sources).toEqual([
      { label: 'Transfer from Guy', cents: 300000, count: 2 },
      { label: 'Refund', cents: 2000, count: 1 },
    ]);
  });
});

describe('everyday Up categories', () => {
  it('files everyday spending in the new cost categories', () => {
    expect(costCategoryFromUp('fuel')).toBe('transport');
    expect(costCategoryFromUp('public-transport')).toBe('transport');
    expect(costCategoryFromUp('health-and-medical')).toBe('health');
    expect(costCategoryFromUp('pets')).toBe('pets');
    expect(costCategoryFromUp('family')).toBe('family');
    expect(costCategoryFromUp('takeaway')).toBe('outing');
    expect(costCategoryFromUp('utilities')).toBe('utilities');
    expect(costCategoryFromUp(null)).toBe('other');
    expect(costCategoryFromUp('something-new')).toBe('other');
  });
});
