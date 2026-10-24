// How often the daily price check looks at each watched item, and which
// items it covers. Paid price searches cost the server money, so a Free
// household's items are checked every few days and only the first ten it
// watches are checked on their own (opening any item still checks it).
// Plus households, the exempt household and self-hosted servers get a
// daily check of everything. An item close to its target or budget is
// checked daily on any plan, so a good price is not missed.
import type { EntitlementTier } from '../../entitlements';
import type { ShopperWant } from './shopper';

const HOUR = 60 * 60 * 1000;

/** A check this recent counts as today's (the run is once a day, give or take). */
export const SHOPPER_DAILY_CHECK_MS = 20 * HOUR;
/** How often a Free household's items are checked. */
export const SHOPPER_FREE_CHECK_MS = 68 * HOUR;
/** Watched items a Free household gets checked on their own. */
export const SHOPPER_FREE_AUTO_CHECKS = 10;

/** Everything is daily when billing is off (self-hosted), for Plus and for the exempt household. */
export function shopperChecksDaily(tier: EntitlementTier, billing: 'on' | 'off'): boolean {
  return billing === 'off' || tier !== 'free';
}

/** The best price is within 10% of the target (or the budget, with no target). */
export function nearItsPrice(want: Pick<ShopperWant, 'target_cents' | 'budget_cents' | 'best_cents'>): boolean {
  const aim = want.target_cents ?? want.budget_cents;
  return aim != null && want.best_cents != null && want.best_cents <= aim * 1.1;
}

/** How long after its last check the daily run checks this item again. */
export function shopperCheckEveryMs(
  want: Pick<ShopperWant, 'target_cents' | 'budget_cents' | 'best_cents'>,
  tier: EntitlementTier,
  billing: 'on' | 'off'
): number {
  return shopperChecksDaily(tier, billing) || nearItsPrice(want) ? SHOPPER_DAILY_CHECK_MS : SHOPPER_FREE_CHECK_MS;
}

/** Ids of the watched items the daily run may check on their own: all of them, or a Free household's first ten. */
export function autoCheckedWants(
  wants: Pick<ShopperWant, 'id' | 'created_at'>[],
  tier: EntitlementTier,
  billing: 'on' | 'off'
): Set<string> {
  const sorted = [...wants].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const kept = shopperChecksDaily(tier, billing) ? sorted : sorted.slice(0, SHOPPER_FREE_AUTO_CHECKS);
  return new Set(kept.map((w) => w.id));
}

/** Due for the daily run: never checked, or checked longer ago than its interval. */
export function wantDue(
  want: Pick<ShopperWant, 'last_checked_at' | 'target_cents' | 'budget_cents' | 'best_cents'>,
  tier: EntitlementTier,
  billing: 'on' | 'off',
  now: Date = new Date()
): boolean {
  if (!want.last_checked_at) return true;
  return now.getTime() - new Date(want.last_checked_at).getTime() >= shopperCheckEveryMs(want, tier, billing);
}

/** The key two households share a source's results under: one search per item, region and day. */
export function sourceCacheKey(query: string, region: string, currency: string): string {
  return `${region.toUpperCase()}:${currency.toUpperCase()}:${query.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}
