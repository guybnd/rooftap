import { describe, expect, it } from "vitest";
import { nextStatus, summarize } from './setup';
import type { SetupItem } from '../../types';

function item(overrides: Partial<SetupItem>): SetupItem {
  return {
    id: "test-id",
    group_id: "test-group",
    name: "Test item",
    room: "Kitchen",
    priority: "medium",
    status: "needed",
    est_price: null,
    actual_price: null,
    where_to_buy: null,
    store_id: null,
    url: null,
    notes: null,
    assigned_to: null,
    private: false,
    template_key: null,
    ai_suggestion: null,
    sort_order: 0,
    created_by: null,
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
    deleted: false,
    ...overrides,
  };
}

describe("nextStatus", () => {
  it("toggles needed -> installed -> needed", () => {
    expect(nextStatus("needed")).toBe("installed");
    expect(nextStatus("installed")).toBe("needed");
  });
});

describe("summarize", () => {
  it("rolls up counts, estimate, spend, and outstanding", () => {
    const items = [
      item({ status: "needed", est_price: 100 }),
      item({ status: "installed", est_price: 200, actual_price: 180 }),
      item({ status: "installed", est_price: 50, actual_price: null }),
    ];
    const summary = summarize(items);
    expect(summary.total).toBe(3);
    expect(summary.counts).toEqual({ needed: 1, installed: 2 });
    expect(summary.est).toBe(350);
    expect(summary.spent).toBe(180);
    expect(summary.outstanding).toBe(1);
  });

  it("returns zeroed totals for an empty list", () => {
    expect(summarize([])).toEqual({ total: 0, counts: {}, est: 0, spent: 0, outstanding: 0 });
  });
});
