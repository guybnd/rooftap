import { beforeEach, describe, expect, it } from 'vitest';
import { costMonth, type LedgerRow } from './cost-month';
import { costShopsToSort, getSkippedShops, resetSkippedShopsForTests, skipShop } from './to-sort';
import type { CostItem } from '../../types';

function row(over: Partial<LedgerRow>): LedgerRow {
  return { month: '2026-10', vendor: 'Shop', costItemId: null, sourceCategory: null, outCents: 1_000, inCents: 0, count: 1, lastAt: '2026-10-10T01:00:00.000Z', source: 'up', ...over };
}

const line = { id: 'coles', group_id: 'g', name: 'Coles', category: 'grocery_estimate', amount: 0, cadence: 'one_off', is_estimate: true, bank_source: 'up', deleted: false } as CostItem;
const now = new Date(2026, 9, 22);

describe('costShopsToSort', () => {
  it("lists this month's unfiled shops, the most money first, with the bank's guess", () => {
    const m = costMonth({
      items: [line],
      ledger: [
        row({ vendor: 'Bunnings', sourceCategory: 'home-maintenance-and-improvements', outCents: 2_000 }),
        row({ vendor: 'Mystery', outCents: 9_000 }),
        row({ vendor: 'Coles', costItemId: 'coles', outCents: 50_000 }),
        // Filed last month, so its shop is known now.
        row({ vendor: 'Coles', month: '2026-09' }),
        row({ vendor: 'COLES', outCents: 3_000, sourceCategory: 'groceries' }),
        row({ vendor: 'Moved', category: 'outing', outCents: 4_000 }),
        row({ vendor: 'Pay', outCents: 0, inCents: 100_000 }),
      ],
      month: '2026-10',
      now,
    });
    const list = costShopsToSort(m);
    expect(list.map((s) => [s.line.name, s.guess])).toEqual([
      ['Mystery', null],
      ['Bunnings', expect.any(String)],
    ]);
    expect(costShopsToSort(m, ['mystery']).map((s) => s.line.name)).toEqual(['Bunnings']);
  });
});

describe('skipShop', () => {
  beforeEach(() => resetSkippedShopsForTests());

  it('keeps a skip for its month only', () => {
    skipShop('2026-10', 'Bunnings');
    skipShop('2026-10', 'Bunnings');
    expect(getSkippedShops('2026-10')).toEqual(['Bunnings']);
    skipShop('2026-11', 'Aldi');
    expect(getSkippedShops('2026-10')).toEqual([]);
    expect(getSkippedShops('2026-11')).toEqual(['Aldi']);
  });
});
