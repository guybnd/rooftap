import { describe, expect, it } from 'vitest';
import { readRecentSpendPrefs, recentBars, recentBillsNote, recentSpend, toggleRecentWindow, DEFAULT_RECENT_SPEND, type DaySpend } from './recent-spend';
import { dayRows, type BankTransaction } from './up-bank';

const now = new Date(2026, 9, 24, 15, 0);
const day = (n: number) => {
  const d = new Date(2026, 9, 24 - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 30 days of $50 a day (5000 cents), plus rent filed under a recurring line 3 days ago.
const history: DaySpend[] = [
  ...Array.from({ length: 31 }, (_, n) => ({ day: day(n), costItemId: null, outCents: 5000 })),
  { day: day(2), costItemId: 'rent', outCents: 450000 },
];
const items = [
  { id: 'rent', cadence: 'monthly' as const, deleted: false, category: 'rent' as const },
  { id: 'shop', cadence: 'one_off' as const, deleted: false, category: 'purchase' as const },
  { id: 'aia', cadence: 'one_off' as const, deleted: false, category: 'insurance' as const },
];

describe('recentSpend', () => {
  it('adds up each window ending today and leaves bills out', () => {
    const [today, three, week] = recentSpend(history, items, { windows: [1, 3, 7], skipBills: true }, now);
    expect(today).toMatchObject({ label: 'Today', cents: 5000, usualCents: 5000, verdict: 'usual' });
    expect(three).toMatchObject({ label: '3 days', cents: 15000 });
    expect(week).toMatchObject({ cents: 35000, usualCents: 35000, diffCents: 0 });
  });

  it('counts bills when asked', () => {
    const [three] = recentSpend(history, items, { windows: [3], skipBills: false }, now);
    expect(three.cents).toBe(465000);
    expect(three.verdict).toBe('over');
  });

  it('has no usual without two weeks of history', () => {
    const [today] = recentSpend(history.filter((d) => d.day >= day(5)), items, { windows: [1], skipBills: true }, now);
    expect(today.usualCents).toBeNull();
    expect(today.verdict).toBeNull();
  });

  it('keeps one big buy from moving usual', () => {
    const spiky = [...history, { day: day(20), costItemId: 'shop', outCents: 156000 }];
    const [week] = recentSpend(spiky, items, { windows: [7], skipBills: true }, now);
    expect(week).toMatchObject({ usualCents: 35000, verdict: 'usual' });
  });

  it('leaves out bills in a bill category even on a one-off line, and by the bank category', () => {
    const more = [...history, { day: day(1), costItemId: 'aia', outCents: 21600 }, { day: day(1), costItemId: null, sourceCategory: 'utilities', outCents: 9000 }];
    const [three] = recentSpend(more, items, { windows: [3], skipBills: true }, now);
    expect(three.cents).toBe(15000);
  });

  it('says how much in bills it left out', () => {
    const insured = [...history, { day: day(0), costItemId: 'aia', outCents: 21632 }];
    const windows = recentSpend(insured, items, { windows: [1, 3, 7], skipBills: true }, now);
    expect(windows.map((w) => w.billCents)).toEqual([21632, 471632, 471632]);
    expect(recentBillsNote(windows)).toBe('Bills not counted: $216 today');
    expect(recentBillsNote(recentSpend(history, items, { windows: [1, 3], skipBills: true }, now))).toBe('Bills not counted: $4,500 in 3 days');
    expect(recentBillsNote(recentSpend(insured, items, { windows: [1, 3], skipBills: false }, now))).toBeNull();
  });

  it('calls a quiet stretch under usual', () => {
    const quiet = history.map((d) => (d.day >= day(6) ? { ...d, outCents: 1000 } : d));
    const [week] = recentSpend(quiet, items, { windows: [7], skipBills: true }, now);
    expect(week.verdict).toBe('under');
  });
});

describe('recentBars', () => {
  it('splits each day by category and lights the window', () => {
    const bars = recentBars([{ day: day(0), costItemId: 'shop', outCents: 900 }, { day: day(0), costItemId: null, sourceCategory: 'groceries', outCents: 100 }], items, true, 3, now);
    expect(bars).toHaveLength(14);
    const today = bars[13];
    expect(today).toMatchObject({ cents: 1000, lit: true, today: true });
    expect(today.segments.map((s) => s.category)).toEqual(['grocery_estimate', 'purchase']);
    expect(bars[10].lit).toBe(false);
  });
});

describe('recent spending choices', () => {
  it('falls back to today, 3 and 7 days', () => {
    expect(readRecentSpendPrefs(null)).toEqual(DEFAULT_RECENT_SPEND);
    expect(readRecentSpendPrefs({ windows: [7, 99, 1, 7], skipBills: false })).toEqual({ windows: [1, 7], skipBills: false, show: true });
  });

  it('keeps at most three windows and at least one', () => {
    expect(toggleRecentWindow(DEFAULT_RECENT_SPEND, 30).windows).toEqual([1, 3, 30]);
    expect(toggleRecentWindow({ ...DEFAULT_RECENT_SPEND, windows: [3] }, 3).windows).toEqual([3]);
  });
});

describe('dayRows', () => {
  const row = (over: Partial<BankTransaction>): BankTransaction => ({
    id: 'r', group_id: 'g', user_id: 'u', source: 'up', external_id: 'x', account_name: null, description: 'Shop', message: null,
    amount_cents: -1000, currency: 'AUD', category: null, parent_category: null, status: 'SETTLED', is_transfer: false,
    occurred_at: '2026-10-23T22:00:00Z', settled_at: null, ...over,
  });
  it('files money out by local day, once per transaction', () => {
    const rows = [row({}), row({ id: 'dup' }), row({ external_id: 'y', amount_cents: 500 }), row({ external_id: 'z', is_transfer: true })];
    expect(dayRows(rows, '2026-10-01T00:00:00Z', -600)).toEqual([{ day: '2026-10-24', costItemId: null, category: null, sourceCategory: null, outCents: 1000 }]);
  });
});
