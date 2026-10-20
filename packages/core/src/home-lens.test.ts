import { describe, expect, it } from 'vitest';
import type { CostItem } from './types';
import type { HeroItem, HeroRange } from './hero';
import { buildBillsLens, buildBudgetLens, isHomeLensKey } from './home-lens';
import { filterHeroFeed, heroRangeCounts, isHeroFeedFiltered, NO_HERO_FEED_FILTER } from './feed';

// Sunday 19 October 2026, mid-morning.
const NOW = new Date(2026, 9, 19, 10, 0);

function cost(overrides: Partial<CostItem>): CostItem {
  return {
    id: 'c1',
    group_id: 'g1',
    name: 'Rent',
    category: 'rent',
    amount: 100_000,
    cadence: 'monthly',
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

describe('isHomeLensKey', () => {
  it('opens lenses for budget, bills and groceries only', () => {
    expect(isHomeLensKey('budgetPulse')).toBe(true);
    expect(isHomeLensKey('billsDue')).toBe(true);
    expect(isHomeLensKey('shoppingList')).toBe(true);
    expect(isHomeLensKey('setupProgress')).toBe(false);
    expect(isHomeLensKey('countdown')).toBe(false);
  });
});

describe('buildBudgetLens', () => {
  it('reports what is left, the committed share and a bar per category', () => {
    const lens = buildBudgetLens(
      [
        cost({ id: 'rent', amount: 300_000 }),
        cost({ id: 'power', category: 'utilities', amount: 30_000, cadence: 'quarterly' }),
        cost({ id: 'sofa', category: 'purchase', amount: 90_000, cadence: 'one_off' }),
      ],
      400_000,
      NOW,
    );
    expect(lens.spentCents).toBe(310_000);
    expect(lens.leftCents).toBe(90_000);
    expect(lens.committedPct).toBe(78);
    // One-offs are not monthly spend.
    expect(lens.categories.map((c) => c.key)).toEqual(['rent', 'utilities']);
    expect(lens.categories[0].share).toBeCloseTo(300_000 / 310_000);
  });

  it('folds the smallest categories into one bar past the cap', () => {
    const cats = ['rent', 'utilities', 'internet', 'insurance', 'subscription', 'other'] as const;
    const items = cats.map((category, i) => cost({ id: category, category, amount: (cats.length - i) * 1000 }));
    const lens = buildBudgetLens(items, null, NOW);
    expect(lens.categories.map((c) => c.key)).toEqual(['rent', 'utilities', 'internet', 'insurance', 'rest']);
    expect(lens.categories[4].cents).toBe(3000);
    expect(lens.leftCents).toBeNull();
    expect(lens.committedPct).toBeNull();
  });

  it('warns about discounts ending within 30 days, soonest first', () => {
    const lens = buildBudgetLens(
      [
        cost({ id: 'net', name: 'Internet', provider: 'Fibre Co', discount_end_date: '2026-10-28' }),
        cost({ id: 'tv', name: 'TV', discount_end_date: '2026-10-21' }),
        cost({ id: 'old', name: 'Old', discount_end_date: '2026-10-01' }),
        cost({ id: 'far', name: 'Far', discount_end_date: '2027-01-01' }),
      ],
      null,
      NOW,
    );
    expect(lens.endingDiscounts).toEqual([
      { id: 'tv', label: 'TV', days: 2 },
      { id: 'net', label: 'Fibre Co', days: 9 },
    ]);
  });
});

describe('buildBillsLens', () => {
  it('lists bills due in the next 30 days with a total and count', () => {
    const lens = buildBillsLens(
      [
        cost({ id: 'power', name: 'Electricity', provider: 'Octopus', amount: 18_600, start_date: '2026-09-23' }),
        cost({ id: 'rent', name: 'Rent', amount: 200_000, start_date: '2026-11-25' }),
        cost({ id: 'tv', name: 'Netflix', amount: 1_800, start_date: '2026-11-03', provider: 'Netflix' }),
        cost({ id: 'undated', name: 'Water' }),
      ],
      NOW,
    );
    expect(lens.rows.map((r) => [r.name, r.days, r.cents, r.provider])).toEqual([
      ['Electricity', 4, 18_600, 'Octopus'],
      ['Netflix', 15, 1_800, null],
    ]);
    expect(lens.totalCents).toBe(20_400);
    expect(lens.dueCount).toBe(2);
  });

  it('adds a discount-ending row that does not count toward the total', () => {
    const lens = buildBillsLens([cost({ id: 'net', name: 'Internet', discount_end_date: '2026-10-28' })], NOW);
    expect(lens.rows).toEqual([
      { key: 'net-discount', costId: 'net', name: 'Internet', provider: null, days: 9, cents: null, discountEnding: true },
    ]);
    expect(lens.totalCents).toBe(0);
    expect(lens.dueCount).toBe(0);
  });
});

describe('feed controls', () => {
  const item = (o: Partial<HeroItem>): HeroItem => ({
    id: 'x',
    type: 'task',
    ownerSection: 'household',
    title: 'X',
    dueDate: null,
    dueTime: null,
    overdue: false,
    done: false,
    assignedTo: null,
    sourceLabel: 'Task',
    ...o,
  });

  it('filters by type and by person', () => {
    const items = [item({ id: 'a', type: 'task', assignedTo: 'me' }), item({ id: 'b', type: 'reminder' })];
    expect(filterHeroFeed(items, { type: 'reminder', mineOnly: false, userId: 'me' }).map((i) => i.id)).toEqual(['b']);
    expect(filterHeroFeed(items, { type: 'all', mineOnly: true, userId: 'me' }).map((i) => i.id)).toEqual(['a']);
    expect(isHeroFeedFiltered(NO_HERO_FEED_FILTER)).toBe(false);
    expect(isHeroFeedFiltered({ type: 'all', mineOnly: true, userId: 'me' })).toBe(true);
  });

  it('counts open items per range under the filter', () => {
    const byRange: Record<HeroRange, HeroItem[]> = {
      today: [item({ id: 'a' }), item({ id: 'done', done: true })],
      week: [item({ id: 'a' }), item({ id: 'b', type: 'reminder' })],
      month: [item({ id: 'a' }), item({ id: 'b', type: 'reminder' }), item({ id: 'c' })],
      upcoming: [item({ id: 'a' }), item({ id: 'b', type: 'reminder' }), item({ id: 'c' }), item({ id: 'd' })],
    };
    expect(heroRangeCounts((r) => byRange[r], NO_HERO_FEED_FILTER)).toEqual({ today: 1, week: 2, month: 3, upcoming: 4 });
    expect(heroRangeCounts((r) => byRange[r], { type: 'task', mineOnly: false, userId: null })).toEqual({
      today: 1,
      week: 1,
      month: 2,
      upcoming: 3,
    });
  });
});
