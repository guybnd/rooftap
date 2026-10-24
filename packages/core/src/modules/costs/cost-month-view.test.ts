import { describe, expect, it } from 'vitest';
import type { CostMonth, CostMonthCategory, CostMonthLine } from './cost-month';
import {
  bankMatchLabel,
  bankRowMeta,
  costCategoryKey,
  costDayLabel,
  lineMeta,
  lineRanks,
  monthBar,
  monthLastDayLabel,
  monthLongName,
  monthShortName,
  goalStatus,
  moneyFlow,
  signedMoney,
} from './cost-month-view';
import type { BankTransactionView } from './up-bank';
import type { CostItem } from '../../types';

function line(over: Partial<CostMonthLine>): CostMonthLine {
  return { kind: 'shop', key: 'k', name: 'Coles', paidCents: 0, toComeCents: 0, count: 0, date: null, source: 'up', ...over };
}

function cat(category: CostMonthCategory['category'], lines: CostMonthLine[], toComeCents = 0): CostMonthCategory {
  return { category, paidCents: lines.reduce((s, l) => s + l.paidCents, 0), toComeCents, lines };
}

function month(over: Partial<CostMonth>): CostMonth {
  return {
    month: '2026-10',
    when: 'current',
    paidCents: 0,
    toComeCents: 0,
    expectedCents: 0,
    incomeCents: 0,
    incomeExpectedCents: null,
    categories: [],
    income: null,
    ...over,
  };
}

describe('moneyFlow', () => {
  it('has no tiles without income', () => {
    expect(moneyFlow(month({}))).toBeNull();
  });

  it('shows the estimate for a future month', () => {
    expect(moneyFlow(month({ when: 'future', incomeExpectedCents: 500_000, expectedCents: 320_000 }))).toEqual({
      incomeLabel: 'Expected income',
      income: 500_000,
      leftLabel: 'Expected left',
      left: 180_000,
    });
  });

  it('shows what came in and went out for a past month', () => {
    expect(moneyFlow(month({ when: 'past', incomeExpectedCents: 500_000, incomeCents: 480_000, paidCents: 300_000 }))).toEqual({
      incomeLabel: 'Income',
      income: 480_000,
      leftLabel: 'Left over',
      left: 180_000,
    });
  });

  it('adds the month-end estimate as hints for the current month', () => {
    const flow = moneyFlow(month({ incomeExpectedCents: 500_000, incomeCents: 200_000, paidCents: 150_000, expectedCents: 320_000 }));
    expect(flow).toMatchObject({ incomeLabel: 'Income so far', income: 200_000, leftLabel: 'In vs out so far', left: 50_000 });
    expect(flow?.incomeHint).toMatch(/^About .+ expected$/);
    expect(flow?.leftHint).toBe(`About ${signedMoney(180_000)} by month end`);
  });

  it('leaves the income hint out once income reached the estimate', () => {
    expect(moneyFlow(month({ incomeExpectedCents: 200_000, incomeCents: 200_000 }))?.incomeHint).toBeUndefined();
  });
});

describe('monthBar', () => {
  const m = month({
    toComeCents: 900,
    categories: [
      cat('grocery_estimate', [line({ key: 'coles', paidCents: 3_000 }), line({ key: 'aldi', paidCents: 1_000 })], 500),
      cat(null, [line({ key: 'x', paidCents: 700 })]),
      cat('rent', [line({ key: 'rent', paidCents: 20_000 })], 400),
    ],
  });

  it('splits paid by category in the fixed palette order, no category last', () => {
    const bar = monthBar(m, null, new Map());
    expect(bar.paid).toBe(24_700);
    expect(bar.toCome).toBe(900);
    expect(bar.segments.map((s) => s.key)).toEqual(['rent', 'grocery_estimate', 'none']);
    expect(bar.segments.every((s) => s.shade === 0)).toBe(true);
  });

  it("shows a picked category's lines in rank order, with their shade", () => {
    const ranks = lineRanks([m], 'grocery_estimate');
    expect([...ranks]).toEqual([['coles', 0], ['aldi', 1]]);
    const bar = monthBar(m, 'grocery_estimate', ranks);
    expect(bar).toMatchObject({ paid: 4_000, toCome: 500 });
    expect(bar.segments.map((s) => [s.label, s.shade])).toEqual([['Coles', 0], ['Coles', 1]]);
  });

  it('ranks nothing without a picked category', () => {
    expect(lineRanks([m], null).size).toBe(0);
  });

  it("keys the no-category bucket as 'none'", () => {
    expect(costCategoryKey(null)).toBe('none');
    expect(costCategoryKey('rent')).toBe('rent');
  });
});

describe('lineMeta', () => {
  const now = new Date(2026, 9, 20, 9);

  it('names each kind of line', () => {
    expect(lineMeta(line({ kind: 'usual' }), 'October', now)).toBe('Usual for the rest of October');
    expect(lineMeta(line({ kind: 'target' }), 'October', now)).toBe('A plan the payments replaced, not counted');
    expect(lineMeta(line({ kind: 'shop', count: 1 }), 'October', now)).toBe('1 payment');
    expect(lineMeta(line({ kind: 'shop', count: 5, date: '2026-10-19T03:00:00Z' }), 'October', now)).toMatch(/^5 payments · last /);
    expect(lineMeta(line({ kind: 'recurring', paidCents: 100, date: '2026-10-01' }), 'October', now)).toBe(`Paid ${costDayLabel('2026-10-01')}`);
    expect(lineMeta(line({ kind: 'recurring', date: '2026-10-28' }), 'October', now)).toBe(`Due ${costDayLabel('2026-10-28')}`);
    expect(lineMeta(line({ kind: 'recurring' }), 'October', now)).toBe('Due');
    expect(lineMeta(line({ kind: 'cost', item: { archived: true } as CostItem }), 'October', now)).toBe('Archived');
    expect(lineMeta(line({ kind: 'cost' }), 'October', now)).toBeNull();
  });
});

describe('bank rows', () => {
  const t = (over: Partial<BankTransactionView>) =>
    ({ pending: false, isTransfer: false, amountCents: -1_000, note: null, ...over }) as BankTransactionView;

  it('joins what is known about a payment', () => {
    expect(bankRowMeta(t({ pending: true, note: 'split' }), { name: 'Coles' } as CostItem, 'Groceries', 'Guy')).toBe('Pending · Groceries · line Coles · split · Guy');
    expect(bankRowMeta(t({}), null, null, null)).toBe('No category yet');
    expect(bankRowMeta(t({ amountCents: 5_000 }), null, 'Groceries', null)).toBe('Money in');
    expect(bankRowMeta(t({ isTransfer: true }), null, 'Groceries', null)).toBe('Transfer');
  });

  it('puts a bank rule in words', () => {
    expect(bankMatchLabel('Coles')).toBe('Payments to "Coles"');
    expect(bankMatchLabel('#groceries')).toBe('Tagged #groceries');
    expect(bankMatchLabel('Coles|#groceries')).toMatch(/^Payments to ".+" or #groceries$/i);
  });
});

describe('labels', () => {
  it('names months and days', () => {
    expect(monthLongName('2026-10')).toBe('October');
    expect(monthShortName('2026-10')).toBe('Oct');
    expect(monthLastDayLabel('2026-02')).toMatch(/28/);
    expect(costDayLabel('2026-10-28')).toMatch(/28/);
  });

  it('signs money', () => {
    expect(signedMoney(-4_500).startsWith('−')).toBe(true);
    expect(signedMoney(4_500).startsWith('+')).toBe(true);
  });
});

describe('goalStatus', () => {
  const today = new Date(2026, 9, 24);

  it('says under so far and heading over as two lines', () => {
    const m = month({ paidCents: 815_400, toComeCents: 272_500, expectedCents: 1_087_900 });
    expect(goalStatus(m, 900_000, today)).toEqual([
      { tone: 'success', lead: 'Under goal so far.', detail: '$846 left with 7 days to go.' },
      { tone: 'warning', lead: 'Heading $1,879 over.', detail: '$2,725 still to come.' },
    ]);
  });

  it('says on track when the estimate fits the goal', () => {
    const m = month({ paidCents: 500_000, toComeCents: 100_000, expectedCents: 600_000 });
    expect(goalStatus(m, 900_000, today)[1]).toEqual({ tone: 'success', lead: 'On track to finish $3,000 under.', detail: '$1,000 still to come.' });
  });

  it('is red only once spending passes the goal', () => {
    const m = month({ paidCents: 950_000, toComeCents: 50_000, expectedCents: 1_000_000 });
    expect(goalStatus(m, 900_000, new Date(2026, 9, 31))).toEqual([
      { tone: 'danger', lead: '$500 over goal.', detail: '$9,500 spent on the last day.' },
      { tone: 'neutral', lead: expect.stringMatching(/^About \$10,000 by /), detail: '$500 still to come.' },
    ]);
  });

  it('keeps one line when nothing is to come', () => {
    expect(goalStatus(month({ paidCents: 100_000, expectedCents: 100_000 }), 900_000, today)).toHaveLength(1);
  });

  it('sums up a finished month and a future one', () => {
    expect(goalStatus(month({ when: 'past', paidCents: 950_000 }), 900_000)).toEqual([{ tone: 'danger', lead: 'Finished $500 over goal.' }]);
    expect(goalStatus(month({ when: 'future', expectedCents: 800_000 }), 900_000)).toEqual([{ tone: 'success', lead: 'Looks $1,000 under goal.' }]);
  });

  it('shows the estimate without a goal', () => {
    expect(goalStatus(month({ paidCents: 100_000, toComeCents: 20_000, expectedCents: 120_000 }), null, today)[0].lead).toMatch(/^About \$1,200 by /);
  });
});
