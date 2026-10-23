import { describe, expect, it } from 'vitest';
import { costMonths, monthKeys } from './cost-month';
import { moneySummariesDue, monthlyMoneyRecap, weeklyCostsSummary } from './money-summary';
import type { CostItem } from './types';

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

const rent = cost({ id: 'rent', name: 'Rent', category: 'rent', amount: 200_000, cadence: 'monthly', start_date: '2026-01-03' });
const internet = cost({ id: 'net', name: 'Internet', category: 'internet', amount: 8_500, cadence: 'monthly', start_date: '2026-01-27' });

function input(items: CostItem[], now: Date, back = 4) {
  return { items, months: costMonths({ items, ledger: [], now }, monthKeys(now, -back, back + 1)), goalCents: 250_000, now };
}

describe('weeklyCostsSummary', () => {
  const now = new Date(2026, 9, 25); // Sunday 25 Oct 2026

  it("sums the week's costs, the bills ahead and where the month is heading", () => {
    const dinner = cost({ id: 'd', name: 'Dinner out', category: 'outing', amount: 12_000, start_date: '2026-10-21' });
    const text = weeklyCostsSummary(input([rent, internet, dinner], now))!;
    expect(text).toContain('**Your week in money:** $120 in costs this week. Most went to Dinner out ($120).');
    expect(text).toContain('Bills in the next 7 days:\n- Internet, $85, in 2 days');
    expect(text).toContain('October is on track for $2,205 of your $2,500 goal, with $2,120 spent so far. [Open Costs](/costs)');
  });

  it('says so when nothing was added', () => {
    const text = weeklyCostsSummary(input([rent, internet], now))!;
    expect(text.startsWith('**Your week in money:** no new costs this week.')).toBe(true);
  });

  it('has nothing to say without costs', () => {
    expect(weeklyCostsSummary(input([], now))).toBeNull();
  });
});

describe('monthlyMoneyRecap', () => {
  const now = new Date(2026, 10, 1); // 1 Nov 2026

  it('sets last month against the goal and the month before', () => {
    const items = [
      rent,
      cost({ id: 'tv', name: 'Television', category: 'purchase', amount: 90_000, start_date: '2026-10-12' }),
      cost({ id: 'sp', name: 'Spotify', category: 'subscription', amount: 1_399, cadence: 'monthly', start_date: '2026-01-05' }),
    ];
    const text = monthlyMoneyRecap(input(items, now))!;
    expect(text).toContain('**Your month in money (October):** $2,914 spent, $414 over your $2,500 goal. That is $900 more than September.');
    expect(text).toContain('Where it went:\n- Rent, $2,000\n- Purchase, $900\n- Subscription, $14');
    expect(text).toContain('Compared with September:\n- Purchase up $900');
    expect(text).toContain('Subscriptions: 1, $14 a month ($168 a year).');
    // One big purchase isn't a pace to project over a year.
    expect(text).not.toContain('a year. At the pace');
  });

  it('has nothing to say about an empty month', () => {
    expect(monthlyMoneyRecap(input([], now))).toBeNull();
  });
});

describe('moneySummariesDue', () => {
  it('is weekly on Sunday and monthly on the 1st', () => {
    expect(moneySummariesDue(new Date(2026, 10, 1))).toEqual(['weekly', 'monthly']);
    expect(moneySummariesDue(new Date(2026, 10, 2))).toEqual([]);
    expect(moneySummariesDue(new Date(2026, 10, 8))).toEqual(['weekly']);
  });
});
