import { describe, expect, it } from "vitest";
import { costSectionSuggestions, costTargets, everydayAverage, monthlyProjection, nextOccurrence, recurringByCategory, type BankActuals } from './costs';
import { costCategoryChoices, costMergeTargets } from './cost-categories';
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

describe("monthlyProjection with bank payments", () => {
  // Jul..Dec 2026, today 20 Oct.
  const from = new Date(2026, 6, 1);
  const now = new Date(2026, 9, 20);
  const power = oneOff({ id: "power", name: "Electricity", category: "utilities", cadence: "monthly", amount: 30_000, is_estimate: true });
  const bank: BankActuals = {
    linked: new Set(["power"]),
    byItem: new Map([["power", new Map([["2026-08", 35_600], ["2026-10", 12_000]])]]),
    since: "2026-08",
  };

  it("counts what was paid in covered past months, the plan before them, at least the plan now, and the plan ahead", () => {
    const totals = monthlyProjection([power], from, 6, now, bank).map((b) => b.total);
    // Jul: not covered, plan. Aug: paid. Sep: covered, nothing paid. Oct: max(plan, paid). Nov, Dec: plan.
    expect(totals).toEqual([30_000, 35_600, 0, 30_000, 30_000, 30_000]);
  });

  it("leaves lines that aren't linked as before", () => {
    const rent = oneOff({ id: "rent", category: "rent", cadence: "monthly", amount: 200_000 });
    const withBank = monthlyProjection([rent], from, 3, now, bank).map((b) => b.total);
    const without = monthlyProjection([rent], from, 3, now).map((b) => b.total);
    expect(withBank).toEqual(without);
  });
});

describe("everyday spend from bank-made one-off lines", () => {
  // Today 20 Oct 2026: the finished months are Sep (counts 3), Aug (2), Jul (1).
  const now = new Date(2026, 9, 20);
  const coles = oneOff({ id: "coles", category: "grocery_estimate", start_date: "2026-10-18", amount: 9_000, bank_source: "up" });
  const cafe = oneOff({ id: "cafe", category: "outing", start_date: "2026-10-02", amount: 1_500, bank_source: "up" });
  const bank: BankActuals = {
    linked: new Set(["coles", "cafe"]),
    byItem: new Map([
      ["coles", new Map([["2026-07", 60_000], ["2026-08", 90_000], ["2026-09", 120_000], ["2026-10", 40_000]])],
      ["cafe", new Map([["2026-09", 6_000], ["2026-10", 9_000]])],
    ]),
    since: null,
  };

  it("weights the latest finished months most", () => {
    // Groceries (3*1200 + 2*900 + 1*600) / 6 = 1000. Going out 3*60 / 6 = 30.
    expect(everydayAverage([coles, cafe], bank, now)).toEqual({ grocery_estimate: 100_000, outing: 3_000 });
  });

  it("leaves out months the bank data doesn't cover", () => {
    // Only Sep and Aug: (3*1200 + 2*900) / 5 = 1080.
    expect(everydayAverage([coles], { ...bank, since: "2026-08" }, now)).toEqual({ grocery_estimate: 108_000 });
  });

  it("shows what was paid behind, the rest of the usual this month, and the usual ahead", () => {
    const buckets = monthlyProjection([coles, cafe], new Date(2026, 8, 1), 3, now, bank);
    // Sep: paid. Oct: paid 400 of a usual 1000 groceries, 90 of a usual 30 going out. Nov: the usual.
    expect(buckets.map((b) => b.total)).toEqual([126_000, 40_000 + 60_000 + 9_000, 103_000]);
    expect(buckets[2].byCategory).toEqual({ grocery_estimate: 100_000, outing: 3_000 });
  });
});

describe("costTargets", () => {
  it("makes a hand-made estimate a target once the bank files lines in its category", () => {
    const groceries = oneOff({ id: "est", category: "grocery_estimate", cadence: "monthly", is_estimate: true });
    const coles = oneOff({ id: "coles", category: "grocery_estimate", cadence: "monthly", is_estimate: true, bank_source: "up" });
    const rent = oneOff({ id: "rent", category: "rent", cadence: "monthly", is_estimate: true });
    expect([...costTargets([groceries, coles, rent])]).toEqual(["est"]);
    expect([...costTargets([groceries, rent])]).toEqual([]);
    expect([...costTargets([groceries, { ...coles, deleted: true }])]).toEqual([]);
  });
});

describe("cost category choices", () => {
  it("hides Pets and Kids and family until a line uses them", () => {
    const none = costCategoryChoices(new Set(["rent"]));
    expect(none).not.toContain("pets");
    expect(none).not.toContain("family");
    expect(none).toContain("transport");
    expect(costCategoryChoices(new Set(["pets"]))).toContain("pets");
    expect(costCategoryChoices(new Set(), "family")).toContain("family");
  });

  it("offers a bank-made line the hand-made lines in its category to merge into", () => {
    const water = oneOff({ id: "water", category: "utilities", cadence: "quarterly" });
    const bankWater = oneOff({ id: "sw", category: "utilities", bank_source: "up" });
    const other = oneOff({ id: "net", category: "internet" });
    expect(costMergeTargets([water, bankWater, other], bankWater, "utilities").map((i) => i.id)).toEqual(["water"]);
    expect(costMergeTargets([water, bankWater], water, "utilities")).toEqual([]);
  });
});
