import { describe, expect, it } from "vitest";
import { costSectionSuggestions, monthlyProjection, nextOccurrence, recurringByCategory } from './costs';
import { isFeatureEnabled } from './module-features';
import { ALL_MODULE_IDS, type ModuleId } from './modules';
import type { CostItem } from './types';

function oneOff(overrides: Partial<CostItem>): CostItem {
  return {
    id: "test-id",
    group_id: "test-group",
    name: "Test purchase",
    category: "purchase",
    amount: 10_000,
    cadence: "one_off",
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
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
    deleted: false,
    ...overrides,
  };
}

describe("monthlyProjection one-off bucketing (FLUX-1577)", () => {
  // `from` = 1 Jun 2026, so bucket 0 = Jun, bucket 1 = Jul, ...
  const from = new Date(2026, 5, 1);
  const now = new Date(2026, 6, 20); // "today" = 20 Jul 2026, matches ticket context

  it("places a dated one-off in its start_date month bucket", () => {
    const items = [oneOff({ start_date: "2026-06-10", amount: 6_000 })];
    const buckets = monthlyProjection(items, from, 12, now);
    expect(buckets[0].total).toBe(6_000);
    expect(buckets[0].byCategory.purchase).toBe(6_000);
    expect(buckets[1].total).toBe(0);
  });

  it("excludes an undated one-off from every bucket", () => {
    const items = [oneOff({ start_date: null, amount: 6_000 })];
    const buckets = monthlyProjection(items, from, 12, now);
    for (const bucket of buckets) {
      expect(bucket.total).toBe(0);
    }
  });

  it("buckets a backfilled row (start_date recovered from created_at) into the recovered month", () => {
    // Mirrors the FLUX-1577 backfill migration: start_date is set from the
    // AU-local date portion of created_at for a legacy row that had no
    // start_date of its own.
    const items = [
      oneOff({ created_at: "2026-06-15T00:00:00.000Z", start_date: "2026-06-15", amount: 4_800 }),
    ];
    const buckets = monthlyProjection(items, from, 12, now);
    expect(buckets[0].total).toBe(4_800);
  });
});

describe("monthlyProjection recurring/oneOff split (FLUX-1578)", () => {
  const from = new Date(2026, 0, 1); // Jan 2026
  const now = new Date(2026, 5, 20); // "today" = 20 Jun 2026 → bucket 5 is current

  function recurringMonthly(overrides: Partial<CostItem>): CostItem {
    return oneOff({
      cadence: "monthly",
      is_estimate: false,
      start_date: null,
      amount: 1_000,
      category: "rent",
      ...overrides,
    });
  }

  it("partitions every bucket into recurring + oneOff === total across a mixed fixture", () => {
    const items = [
      recurringMonthly({ category: "rent", amount: 2_000 }),
      // is_estimate recurring in a category with no matching one-off actual this year.
      recurringMonthly({ category: "utilities", cadence: "monthly", is_estimate: true, amount: 300 }),
      oneOff({ category: "purchase", start_date: "2026-03-10", amount: 5_000, name: "Car repair" }),
    ];
    const buckets = monthlyProjection(items, from, 12, now);
    for (const bucket of buckets) {
      expect(bucket.recurring + bucket.oneOff).toBe(bucket.total);
    }
    // March: named one-off shows up, category tagged, not double-counted into recurring.
    expect(buckets[2].oneOffItems).toEqual([{ name: "Car repair", category: "purchase", amount: 5_000 }]);
    expect(buckets[2].oneOff).toBe(5_000);
  });

  it("excludes a real actual in an is_estimate category from oneOffItems (folded into recurring instead)", () => {
    const items = [
      recurringMonthly({ category: "grocery_estimate", cadence: "monthly", is_estimate: true, amount: 800 }),
      oneOff({ category: "grocery_estimate", start_date: "2026-02-05", amount: 950, name: "Groceries", is_estimate: false }),
    ];
    const buckets = monthlyProjection(items, from, 12, now);
    // Feb (bucket 1): real actual (950) beats the estimate (800) via step-back, folded into recurring.
    expect(buckets[1].oneOffItems).toEqual([]);
    expect(buckets[1].oneOff).toBe(0);
    expect(buckets[1].recurring).toBe(950);
  });

  it("future buckets carry oneOff === 0 and oneOffItems === [] (recurring-only projection)", () => {
    const items = [recurringMonthly({ category: "rent", amount: 2_000 })];
    const buckets = monthlyProjection(items, from, 12, now);
    for (const bucket of buckets.slice(6)) {
      // buckets[6..11] = Jul..Dec, strictly after the "now" month (bucket 5 = Jun).
      expect(bucket.oneOff).toBe(0);
      expect(bucket.oneOffItems).toEqual([]);
      expect(bucket.recurring).toBe(2_000);
    }
  });

  it("gates a named one-off's oneOffItems push by the same in-window guard as its total contribution", () => {
    // start_date a year before the window — `add`'s idx<0 guard drops it entirely.
    const items = [oneOff({ category: "purchase", start_date: "2025-06-10", amount: 5_000, name: "Old repair" })];
    const buckets = monthlyProjection(items, from, 12, now);
    for (const bucket of buckets) {
      expect(bucket.total).toBe(0);
      expect(bucket.oneOffItems).toEqual([]);
    }
  });
});

describe("nextOccurrence end_date handling (FLUX-262)", () => {
  const from = new Date(2026, 6, 20); // 20 Jul 2026

  it("returns null once the advanced occurrence falls after end_date (contract ended)", () => {
    const item = { cadence: "monthly" as const, start_date: "2026-01-15", end_date: "2026-06-30" };
    expect(nextOccurrence(item, from)).toBeNull();
  });

  it("still returns the occurrence when end_date is in the future", () => {
    const item = { cadence: "monthly" as const, start_date: "2026-01-15", end_date: "2026-12-31" };
    expect(nextOccurrence(item, from)).toEqual(new Date(2026, 7, 15));
  });

  it("returns the occurrence as normal when end_date is null", () => {
    const item = { cadence: "monthly" as const, start_date: "2026-01-15", end_date: null };
    expect(nextOccurrence(item, from)).toEqual(new Date(2026, 7, 15));
  });

  it("does not apply end_date gating to one_off items", () => {
    const item = { cadence: "one_off" as const, start_date: "2026-08-01", end_date: "2026-06-30" };
    expect(nextOccurrence(item, from)).toEqual(new Date(2026, 7, 1));
  });
});

describe("costSectionSuggestions", () => {
  const base = { items: [], rentWeeklyCents: 50_000, setupTotalCents: 120_000 };
  const forModules = (on: Set<string>) =>
    costSectionSuggestions({
      ...base,
      rentEnabled: isFeatureEnabled("costs.suggest-rent", on),
      setupEnabled: isFeatureEnabled("costs.suggest-setup", on),
    });

  it("shows both with every module on", () => {
    expect(forModules(new Set(ALL_MODULE_IDS))).toEqual({ rent: true, setup: true });
  });

  // Each suggestion disappears on its own; an unrelated module leaves both.
  it.each(ALL_MODULE_IDS)("turning %s off", (off: ModuleId) => {
    const on = new Set<string>(ALL_MODULE_IDS.filter((m) => m !== off));
    expect(forModules(on)).toEqual({
      rent: off !== "costs" && off !== "search",
      setup: off !== "costs" && off !== "setup",
    });
  });

  it("hides the whole block when both sources are off", () => {
    const on = new Set<string>(ALL_MODULE_IDS.filter((m) => m !== "search" && m !== "setup"));
    expect(forModules(on)).toEqual({ rent: false, setup: false });
  });

  it.each([
    { name: "no rent value", input: { rentWeeklyCents: 0 }, expected: { rent: false, setup: true } },
    { name: "no setup value", input: { setupTotalCents: 0 }, expected: { rent: true, setup: false } },
    { name: "a rent line exists", input: { items: [{ linked_section: null, category: "rent" as const }] }, expected: { rent: false, setup: true } },
    { name: "a linked rent line exists", input: { items: [{ linked_section: "home_search", category: "utilities" as const }] }, expected: { rent: false, setup: true } },
    { name: "a setup line exists", input: { items: [{ linked_section: "home_setup", category: "moving" as const }] }, expected: { rent: true, setup: false } },
  ])("with every module on, $name", ({ input, expected }) => {
    expect(costSectionSuggestions({ ...base, rentEnabled: true, setupEnabled: true, ...input })).toEqual(expected);
  });
});

describe("recurringByCategory", () => {
  it("splits recurring spend by category in palette order, net of one-offs", () => {
    const segs = recurringByCategory({
      label: "Oct",
      total: 1_300,
      recurring: 1_000,
      oneOff: 300,
      byCategory: { utilities: 400, rent: 600, purchase: 300 },
      oneOffItems: [{ name: "Couch", category: "purchase", amount: 300 }],
    });
    expect(segs).toEqual([
      { category: "rent", amount: 600 },
      { category: "utilities", amount: 400 },
    ]);
  });
});
