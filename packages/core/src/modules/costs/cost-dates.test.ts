import { describe, expect, it } from 'vitest';
import type { CostItem } from '../../types';
import { costDateLabel, costRowDateLabel, expiryLabel, soonestCostExpiry } from './cost-dates';

const now = new Date(2026, 9, 23, 12);

describe('costDateLabel', () => {
  it('says the day relative to today', () => {
    expect(costDateLabel(new Date(2026, 9, 23), now)).toBe('Today');
    expect(costDateLabel(new Date(2026, 9, 24), now)).toBe('Tomorrow');
    expect(costDateLabel(new Date(2026, 9, 22), now)).toBe('Yesterday');
    expect(costDateLabel(new Date(2026, 9, 26), now)).toBe('Mon');
    expect(costDateLabel(new Date(2026, 10, 5), now)).toBe('Nov 5');
  });
});

describe('expiryLabel', () => {
  it('reads ended, today and in N days', () => {
    expect(expiryLabel('Contract', -3)).toBe('Contract ended 3d ago');
    expect(expiryLabel('Discount', 0)).toBe('Discount ends today');
    expect(expiryLabel('Discount', 20)).toBe('Discount ends in 20d');
  });
});

describe('soonestCostExpiry', () => {
  it('picks the earlier of the contract and discount ends', () => {
    expect(soonestCostExpiry({ end_date: '2026-12-01', discount_end_date: '2026-11-02' }, now)).toEqual({ kind: 'Discount', date: '2026-11-02', days: 10 });
    expect(soonestCostExpiry({ end_date: '2026-10-20', discount_end_date: null }, now)).toEqual({ kind: 'Contract', date: '2026-10-20', days: -3 });
    expect(soonestCostExpiry({ end_date: null, discount_end_date: null }, now)).toBeNull();
  });
});

describe('costRowDateLabel', () => {
  const base = { id: 'c1', name: 'Couch', category: 'purchase', amount: 100, cadence: 'one_off', created_at: null } as unknown as CostItem;

  it("uses a one-off's date", () => {
    expect(costRowDateLabel({ ...base, start_date: '2026-10-24' }, now)).toBe('Tomorrow');
  });

  it('falls back to when it was added, else nothing', () => {
    expect(costRowDateLabel({ ...base, start_date: null, created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }, now)).toBe('added 3d ago');
    expect(costRowDateLabel({ ...base, start_date: null }, now)).toBeNull();
  });
});
