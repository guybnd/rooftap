import { describe, expect, it } from 'vitest';
import {
  SHOPPER_FREE_AUTO_CHECKS,
  autoCheckedWants,
  nearItsPrice,
  shopperCheckEveryMs,
  SHOPPER_DAILY_CHECK_MS,
  SHOPPER_FREE_CHECK_MS,
  sourceCacheKey,
  wantDue,
} from './shopper-checks';

const want = { target_cents: null, budget_cents: 10000, best_cents: 20000 };
const hoursAgo = (h: number, now: Date) => new Date(now.getTime() - h * 3600_000).toISOString();

describe('shopper checks', () => {
  it('checks daily on Plus, exempt and self-hosted, every few days on Free', () => {
    expect(shopperCheckEveryMs(want, 'plus', 'on')).toBe(SHOPPER_DAILY_CHECK_MS);
    expect(shopperCheckEveryMs(want, 'exempt', 'on')).toBe(SHOPPER_DAILY_CHECK_MS);
    expect(shopperCheckEveryMs(want, 'free', 'off')).toBe(SHOPPER_DAILY_CHECK_MS);
    expect(shopperCheckEveryMs(want, 'free', 'on')).toBe(SHOPPER_FREE_CHECK_MS);
  });

  it('checks an item near its price daily on any plan', () => {
    expect(nearItsPrice({ target_cents: null, budget_cents: 10000, best_cents: 10900 })).toBe(true);
    expect(nearItsPrice({ target_cents: 8000, budget_cents: 10000, best_cents: 9500 })).toBe(false);
    expect(nearItsPrice({ target_cents: null, budget_cents: null, best_cents: 1 })).toBe(false);
    expect(shopperCheckEveryMs({ ...want, best_cents: 10500 }, 'free', 'on')).toBe(SHOPPER_DAILY_CHECK_MS);
  });

  it('knows when an item is due', () => {
    const now = new Date('2026-10-24T19:00:00Z');
    expect(wantDue({ ...want, last_checked_at: null }, 'free', 'on', now)).toBe(true);
    expect(wantDue({ ...want, last_checked_at: hoursAgo(24, now) }, 'free', 'on', now)).toBe(false);
    expect(wantDue({ ...want, last_checked_at: hoursAgo(72, now) }, 'free', 'on', now)).toBe(true);
    expect(wantDue({ ...want, last_checked_at: hoursAgo(24, now) }, 'plus', 'on', now)).toBe(true);
  });

  it("checks a Free household's first ten items on their own", () => {
    const wants = Array.from({ length: 14 }, (_, i) => ({ id: `w${i}`, created_at: `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00Z` }));
    const free = autoCheckedWants([...wants].reverse(), 'free', 'on');
    expect(free.size).toBe(SHOPPER_FREE_AUTO_CHECKS);
    expect(free.has('w0')).toBe(true);
    expect(free.has('w13')).toBe(false);
    expect(autoCheckedWants(wants, 'plus', 'on').size).toBe(14);
    expect(autoCheckedWants(wants, 'free', 'off').size).toBe(14);
  });

  it('shares results by item, region and currency', () => {
    expect(sourceCacheKey('  LG  C5 65" ', 'au', 'aud')).toBe('AU:AUD:lg c5 65"');
  });
});
