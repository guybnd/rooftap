import { describe, expect, it } from 'vitest';
import {
  buildGiftIdea,
  buildGiftWant,
  buildOccasion,
  daysToOccasion,
  defaultHiddenFrom,
  giftCostName,
  giftCostsToReveal,
  hidesFromSomeoneNew,
  keptFromLabel,
  nextOccasionDay,
  occasionSpend,
  occasionsOnDay,
  isOnCalendar,
  occasionSubtitle,
  occasionWhenLabel,
  planGiftCost,
  previousOccasionDay,
  sortOccasions,
  surpriseOver,
  takenBy,
  weekdayDayMonthLabel,
  wishlistOccasion,
  type GiftIdea,
  type Occasion,
} from './occasions';
import { buildPlanToBuyCost, buildPlanToBuyTask, isKeptFrom, planToBuyTitle } from '../shopper/shopper';

const GUY = 'u-guy';
const TEGAN = 'u-tegan';
const profiles = {
  [GUY]: { email: 'guy@example.com', name: 'Guy B', avatar: null },
  [TEGAN]: { email: 'tegan@example.com', name: 'Tegan', avatar: null },
};

function occasion(over: Partial<Occasion> = {}): Occasion {
  return {
    ...buildOccasion({ id: 'o1', groupId: 'g', title: "Tegan's birthday", kind: 'birthday', date: '1990-11-15', personId: TEGAN, createdBy: GUY }),
    ...over,
  };
}

function idea(over: Partial<GiftIdea> = {}): GiftIdea {
  return {
    ...buildGiftIdea({ id: 'i1', groupId: 'g', title: 'Linen robe', occasionId: 'o1', forUserId: TEGAN, priceCents: 8900, hiddenFrom: [TEGAN], createdBy: GUY }),
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

describe('occasion days', () => {
  it('repeats every year, today included', () => {
    const o = occasion();
    expect(nextOccasionDay(o, '2026-10-23')).toBe('2026-11-15');
    expect(nextOccasionDay(o, '2026-11-15')).toBe('2026-11-15');
    expect(nextOccasionDay(o, '2026-11-16')).toBe('2027-11-15');
    expect(daysToOccasion(o, '2026-10-23')).toBe(23);
  });

  it('puts 29 February on the 28th in other years', () => {
    const o = occasion({ date: '2000-02-29' });
    expect(nextOccasionDay(o, '2026-01-01')).toBe('2026-02-28');
    expect(nextOccasionDay(o, '2027-03-01')).toBe('2028-02-29');
  });

  it('gives a one-off day once, then never again', () => {
    const o = occasion({ date: '2026-12-01', repeats: false });
    expect(nextOccasionDay(o, '2026-10-23')).toBe('2026-12-01');
    expect(nextOccasionDay(o, '2026-12-02')).toBeNull();
    expect(occasionWhenLabel(o, '2026-12-02')).toBe('Passed');
  });

  it('starts a day added for a future year in that year', () => {
    const o = occasion({ date: '2028-05-01' });
    expect(nextOccasionDay(o, '2026-10-23')).toBe('2028-05-01');
    expect(previousOccasionDay(o, '2026-10-23')).toBeNull();
  });

  it('finds the last time it fell, before today', () => {
    const o = occasion();
    expect(previousOccasionDay(o, '2026-11-15')).toBe('2025-11-15');
    expect(previousOccasionDay(o, '2026-11-16')).toBe('2026-11-15');
  });

  it('labels when it is', () => {
    expect(occasionWhenLabel(occasion(), '2026-11-15')).toBe('Today');
    expect(occasionWhenLabel(occasion(), '2026-11-14')).toBe('Tomorrow');
    expect(occasionWhenLabel(occasion(), '2026-10-23')).toBe('23 days');
    expect(occasionWhenLabel(occasion({ date: '2020-02-14' }), '2026-10-23')).toBe('Feb');
    expect(weekdayDayMonthLabel('2026-11-15')).toBe('Sun 15 Nov');
  });

  it('sorts soonest first, with passed one-off days last', () => {
    const list = [
      occasion({ id: 'a', title: 'Christmas', date: '2000-12-25' }),
      occasion({ id: 'b', title: 'Old party', date: '2025-01-01', repeats: false }),
      occasion({ id: 'c', title: 'Tegan', date: '1990-11-15' }),
    ];
    expect(sortOccasions(list, '2026-10-23').map((o) => o.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('on the calendar', () => {
  it('falls on its day every year, a one-off only once, and not when switched off', () => {
    const birthday = occasion();
    const party = occasion({ id: 'o2', title: 'Party', repeats: false, date: '2026-11-15' });
    const hidden = occasion({ id: 'o3', title: 'Quiet one', on_calendar: false });
    expect(occasionsOnDay([birthday, party, hidden], '2026-11-15').map((o) => o.id)).toEqual(['o2', 'o1']);
    expect(occasionsOnDay([birthday, party], '2027-11-15').map((o) => o.id)).toEqual(['o1']);
    expect(occasionsOnDay([birthday], '1989-11-15')).toEqual([]);
    expect(occasionsOnDay([birthday], '2026-11-16')).toEqual([]);
  });

  it('is on unless switched off, and a new occasion only carries the field when asked', () => {
    expect(isOnCalendar(occasion())).toBe(true);
    expect(isOnCalendar(occasion({ on_calendar: false }))).toBe(false);
    expect('on_calendar' in occasion()).toBe(false);
    const withField = buildOccasion({ id: 'o4', groupId: 'g', title: 'x', kind: 'other', date: '2026-01-01', onCalendar: false, createdBy: GUY });
    expect(withField.on_calendar).toBe(false);
  });
});

describe('keep it from', () => {
  it('keeps a gift from the member it is for, never from yourself or a name', () => {
    expect(defaultHiddenFrom(TEGAN, GUY, [GUY, TEGAN])).toEqual([TEGAN]);
    expect(defaultHiddenFrom(GUY, GUY, [GUY, TEGAN])).toEqual([]);
    expect(defaultHiddenFrom(null, GUY, [GUY, TEGAN])).toEqual([]);
    expect(defaultHiddenFrom('u-left', GUY, [GUY, TEGAN])).toEqual([]);
  });

  it('names who it is kept from', () => {
    expect(keptFromLabel([TEGAN], profiles)).toBe('Kept from Tegan');
    expect(keptFromLabel([TEGAN, GUY], profiles)).toBe('Kept from Tegan and Guy');
    expect(keptFromLabel([], profiles)).toBeNull();
  });

  it('replaces the row only when it hides from someone new', () => {
    expect(hidesFromSomeoneNew([], [TEGAN])).toBe(true);
    expect(hidesFromSomeoneNew([TEGAN], [TEGAN])).toBe(false);
    expect(hidesFromSomeoneNew([TEGAN], [])).toBe(false);
    expect(hidesFromSomeoneNew([TEGAN], [TEGAN, GUY])).toBe(true);
  });

  it('shows a member only a date on their own occasion', () => {
    const o = occasion();
    expect(occasionSubtitle(o, [], TEGAN, profiles)).toBe('15 Nov');
    expect(occasionSubtitle(o, [idea()], GUY, profiles)).toBe('15 Nov · 1 idea, kept from Tegan');
    const shared = occasion({ id: 'o2', title: 'Our anniversary', kind: 'anniversary', person_id: null, date: '2019-02-14' });
    expect(occasionSubtitle(shared, [], GUY, profiles)).toBe('14 Feb · shared');
  });
});

describe('gift budget', () => {
  it('adds up spent and planned', () => {
    expect(
      occasionSpend([
        { status: 'booked', price_cents: 14000 },
        { status: 'watching', price_cents: 8900 },
        { status: 'idea', price_cents: null },
      ]),
    ).toEqual({ spent: 14000, planned: 22900 });
  });

  it('calls a kept gift only "Gift" until the day has passed', () => {
    const o = occasion();
    expect(giftCostName(idea(), o, '2026-10-23', '2026-11-15')).toBe('Gift');
    expect(surpriseOver(o, '2026-10-23', '2026-11-16')).toBe(true);
    expect(giftCostName(idea(), o, '2026-10-23', '2026-11-16')).toBe('Linen robe');
    expect(giftCostName(idea({ hidden_from: [] }), o, '2026-10-23', '2026-10-23')).toBe('Linen robe');
    // Bought after this year's day: kept until next year's.
    expect(giftCostName(idea(), o, '2026-11-20', '2026-12-01')).toBe('Gift');
  });

  it('makes, updates and removes the Budget line with no store', () => {
    const o = occasion();
    let n = 0;
    const newId = () => `c${++n}`;
    const made = planGiftCost({ idea: idea(), inBudget: true, occasion: o, existing: null, newId, today: '2026-10-23' });
    expect(made.change.kind).toBe('create');
    if (made.change.kind !== 'create') return;
    expect(made.change.cost).toMatchObject({ name: 'Gift', provider: null, amount: 8900, linked_section: 'occasions', category: 'purchase' });
    expect(made.idea.cost_item_id).toBe('c1');

    const existing = { id: 'c1', name: 'Gift', amount: 8900, start_date: '2026-10-23' };
    const same = planGiftCost({ idea: made.idea, inBudget: true, occasion: o, existing, newId, today: '2026-10-24' });
    expect(same.change.kind).toBe('none');
    const pricier = planGiftCost({ idea: { ...made.idea, price_cents: 9900 }, inBudget: true, occasion: o, existing, newId, today: '2026-10-24' });
    expect(pricier.change).toEqual({ kind: 'update', id: 'c1', patch: { name: 'Gift', amount: 9900 } });
    const out = planGiftCost({ idea: made.idea, inBudget: false, occasion: o, existing, newId, today: '2026-10-24' });
    expect(out.change).toEqual({ kind: 'remove', id: 'c1' });
    expect(out.idea.cost_item_id).toBeNull();
  });

  it('names the line once the day has passed', () => {
    const ideas = [idea({ cost_item_id: 'c1' })];
    const occasions = new Map([['o1', occasion()]]);
    const costs = new Map([['c1', { id: 'c1', name: 'Gift', start_date: '2026-10-23', deleted: false }]]);
    expect(giftCostsToReveal(ideas, occasions, costs, '2026-11-15')).toEqual([]);
    expect(giftCostsToReveal(ideas, occasions, costs, '2026-11-16')).toEqual([{ id: 'c1', name: 'Linen robe' }]);
  });
});

describe('links', () => {
  it('watches the price kept from the same people, needed a few days early', () => {
    const want = buildGiftWant({ id: 'w1', idea: idea(), occasion: occasion(), today: '2026-10-23', createdBy: GUY });
    expect(want).toMatchObject({ title: 'Linen robe', hidden_from: [TEGAN], need_by: '2026-11-12', budget_cents: 8900, status: 'watching' });
  });

  it('keeps a kept watch out of Plan to buy names', () => {
    const want = buildGiftWant({ id: 'w1', idea: idea(), occasion: occasion(), today: '2026-10-23', createdBy: GUY });
    const offer = { store: 'Myer', price_cents: 8900, url: 'https://example.com/robe' };
    expect(planToBuyTitle(want, 'Myer')).toBe('Buy a gift');
    expect(buildPlanToBuyTask({ id: 't1', want, offer, priceLabel: '$89' })).toMatchObject({ title: 'Buy a gift', notes: null });
    expect(buildPlanToBuyCost({ id: 'c1', want, offer })).toMatchObject({ name: 'Gift', provider: null });
    expect(isKeptFrom(want, TEGAN)).toBe(true);
    expect(isKeptFrom(want, GUY)).toBe(false);
    const open = { ...want, hidden_from: [] };
    expect(planToBuyTitle(open, 'Myer')).toBe('Buy Linen robe at Myer');
  });

  it('files a taken wish under its owner\'s next birthday', () => {
    const list = [occasion(), occasion({ id: 'o2', title: 'Christmas', kind: 'holiday', person_id: null })];
    expect(wishlistOccasion(TEGAN, list, '2026-10-23')?.id).toBe('o1');
    expect(wishlistOccasion(GUY, list, '2026-10-23')).toBeNull();
    expect(takenBy({ id: 'w1' }, [idea({ wishlist_item_id: 'w1' })])?.id).toBe('i1');
  });
});
