import { describe, expect, it } from 'vitest';
import { costInsights, withInsightMark, withoutInsightMark } from './cost-insights';
import { costMonths, monthKeys, type LedgerRow } from '../costs/cost-month';
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
  return { month: '2026-10', vendor: 'Shop', costItemId: null, sourceCategory: null, outCents: 0, inCents: 0, count: 1, lastAt: '2026-10-10T01:00:00.000Z', source: 'up', ...overrides };
}

const now = new Date(2026, 9, 22); // 22 Oct 2026

function run(items: CostItem[], ledger: LedgerRow[] = [], extra: Partial<Parameters<typeof costInsights>[0]> = {}) {
  const months = costMonths({ items, ledger, now }, monthKeys(now, -3, 4));
  return costInsights({ items, months, now, ...extra });
}

describe('costInsights', () => {
  const netflix = cost({ id: 'nf', name: 'Netflix', category: 'subscription', amount: 2_499, cadence: 'monthly', start_date: '2025-03-12', price_changes: [{ from: '2026-10-12', amount: 2_499 }] });
  const stan = cost({ id: 'stan', name: 'Stan', category: 'subscription', amount: 1_700, cadence: 'monthly', start_date: '2024-03-02' });
  const spotify = cost({ id: 'sp', name: 'Spotify', category: 'subscription', amount: 1_399, cadence: 'monthly', start_date: '2024-01-05' });

  it('shows a price change made by hand, a year of it as the figure', () => {
    const withOld = { ...netflix, amount: 1_899 };
    const { insights } = run([withOld]);
    const price = insights.find((i) => i.kind === 'price')!;
    expect(price).toMatchObject({ group: 'heads-up', title: 'Netflix went up', action: 'open-item' });
    expect(price.detail).toBe('$19 to $25/mo, changed 10 days ago');
    expect(price.figure).toEqual({ text: '+$72 a year', tone: 'warning' });
  });

  it('lists subscriptions and spots streaming services that overlap', () => {
    const { insights, subscriptions } = run([netflix, stan, spotify]);
    expect(subscriptions.map((s) => s.name)).toEqual(['Netflix', 'Stan', 'Spotify']);
    expect(subscriptions.find((s) => s.name === 'Stan')?.overlap).toBe('Streaming');
    expect(subscriptions.find((s) => s.name === 'Spotify')?.overlap).toBeNull();
    const overlap = insights.find((i) => i.kind === 'overlap')!;
    expect(overlap).toMatchObject({ group: 'reconsider', title: '2 streaming services', action: 'review' });
    expect(insights.find((i) => i.kind === 'subscriptions')?.title).toBe('3 subscriptions');
  });

  it('keeps a subscription out of the overlap for a year', () => {
    const marks = withInsightMark({}, 'keep:sub:stan', now);
    const { insights, subscriptions } = run([netflix, stan, spotify], [], { marks });
    expect(subscriptions.find((s) => s.name === 'Stan')?.kept).toBe(true);
    expect(insights.find((i) => i.kind === 'overlap')).toBeUndefined();
    expect(insights.find((i) => i.kind === 'subscriptions')?.detail).toContain('1 kept');
  });

  it('hides an insight until what it says changes', () => {
    const first = run([netflix, stan]);
    const overlap = first.insights.find((i) => i.kind === 'overlap')!;
    const marks = withInsightMark({}, overlap.key, now);
    expect(run([netflix, stan], [], { marks }).insights.find((i) => i.kind === 'overlap')).toBeUndefined();
    const binge = cost({ id: 'binge', name: 'Binge', category: 'subscription', amount: 1_800, cadence: 'monthly', start_date: '2026-01-01' });
    expect(run([netflix, stan, binge], [], { marks }).insights.find((i) => i.kind === 'overlap')?.title).toBe('3 streaming services');
    expect(withoutInsightMark(marks, overlap.key)).toEqual({});
  });

  it('finds a subscription the bank pays, and its new price', () => {
    const ledger = [
      row({ month: '2026-08', vendor: 'Disney Plus', sourceCategory: 'tv-and-music', outCents: 1_399 }),
      row({ month: '2026-09', vendor: 'Disney Plus', sourceCategory: 'tv-and-music', outCents: 1_399 }),
      row({ month: '2026-10', vendor: 'Disney Plus', sourceCategory: 'tv-and-music', outCents: 1_799 }),
      row({ month: '2026-10', vendor: 'Steam', sourceCategory: 'games-and-software', outCents: 5_000 }),
    ];
    const { insights, subscriptions } = run([], ledger);
    expect(subscriptions.map((s) => [s.name, s.monthlyCents])).toEqual([['Disney Plus', 1_799]]);
    expect(insights.find((i) => i.kind === 'price')?.figure?.text).toBe('+$48 a year');
  });

  it('flags a plan ending within a month, with a Scout brief', () => {
    const power = cost({ id: 'pw', name: 'Electricity', provider: 'Origin', category: 'utilities', amount: 18_000, cadence: 'monthly', start_date: '2025-11-14', end_date: '2026-11-14' });
    const ending = run([power]).insights.find((i) => i.kind === 'ending')!;
    expect(ending).toMatchObject({ group: 'save', title: 'Electricity plan ends in 23 days', action: 'compare' });
    expect(ending.compare).toEqual({ text: 'A cheaper Origin plan', upTo: '180' });
    const later = cost({ ...power, end_date: '2027-02-01' });
    expect(run([later]).insights.find((i) => i.kind === 'ending')).toBeUndefined();
  });

  it('compares a category with its usual pace, from costs added by hand', () => {
    const cafes = [
      cost({ id: 'c1', name: 'Cafe', category: 'outing', amount: 20_000, start_date: '2026-07-10' }),
      cost({ id: 'c2', name: 'Cafe', category: 'outing', amount: 20_000, start_date: '2026-08-10' }),
      cost({ id: 'c3', name: 'Cafe', category: 'outing', amount: 20_000, start_date: '2026-09-10' }),
      cost({ id: 'c4', name: 'Cafe', category: 'outing', amount: 30_000, start_date: '2026-10-05' }),
    ];
    const ahead = run(cafes).insights.find((i) => i.kind === 'ahead')!;
    expect(ahead).toMatchObject({ group: 'heads-up', category: 'outing', action: 'open-category' });
    expect(ahead.figure?.tone).toBe('warning');

    const quiet = [...cafes.slice(0, 3), cost({ id: 'c4', name: 'Cafe', category: 'outing', amount: 2_000, start_date: '2026-10-05' })];
    const under = run(quiet).insights.find((i) => i.kind === 'under')!;
    expect(under).toMatchObject({ group: 'going-well' });
    expect(under.figure?.tone).toBe('success');
  });

  it('says how much a chosen category costs over a year', () => {
    const out = [7, 8, 9].map((m) => cost({ id: `o${m}`, name: 'Dinner', category: 'outing', amount: 26_000, start_date: `2026-0${m}-10` }));
    expect(run(out).insights.find((i) => i.kind === 'yearly')?.title).toBe('Going out costs about $3,120 a year');
  });

  it('turns bank nudges into insights and leaves their pace check to costMonth', () => {
    const bill = cost({ id: 'net', name: 'Internet', category: 'internet', amount: 8_500, cadence: 'monthly', start_date: '2026-01-28' });
    const { insights } = run([bill], [], {
      nudges: [
        { kind: 'missing', key: 'missing:net', item: bill, dueOn: new Date(2026, 9, 15), amountCents: 8_500 },
        { kind: 'ahead', key: 'ahead:outing', category: 'outing', paidCents: 50_000, usualCents: 20_000 },
      ],
    });
    expect(insights.map((i) => i.kind)).toEqual(['missing']);
    expect(insights[0]).toMatchObject({ title: "Internet hasn't come out", key: 'missing:net:2026-10-15' });
  });

  it('puts what needs attention first', () => {
    const kinds = run([netflix, stan, { ...netflix, id: 'nf2', name: 'Kayo', amount: 2_500, price_changes: [{ from: '2026-10-01', amount: 2_500 }] }]).insights.map((i) => i.group);
    const order = ['heads-up', 'save', 'reconsider', 'going-well'];
    expect([...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(kinds);
  });

  it('drops marks older than 13 months when it adds one', () => {
    const marks = { old: '2025-01-01T00:00:00.000Z', recent: '2026-10-01T00:00:00.000Z' };
    expect(Object.keys(withInsightMark(marks, 'new', now)).sort()).toEqual(['new', 'recent']);
  });
});
