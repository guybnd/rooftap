import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// u2 shares nothing with u1, so u1 never sees or changes u2's payments.
vi.mock("@/lib/up-bank", () => ({
  applyBankLinks: vi.fn(async () => {}),
  bankLinkRows: vi.fn(async () => []),
  visibleBankTransactions: vi.fn(async () => []),
  bankSharing: vi.fn(async (_admin: unknown, viewerId: string) => ({ viewerId, modes: { u2: "none" }, joint: {} })),
}));

import { filePaymentInCategory, moveShopToCategory } from "./bank-actions";

// Just enough of the admin client for filePaymentInCategory: eq filters,
// maybeSingle reads and updates that patch the matching rows.
type Row = Record<string, unknown>;
function fakeAdmin(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
        in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
        gte: () => b,
        order: () => b,
        limit: () => b,
        update: (p: Row) => ((patch = p), b),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
          if (patch) for (const r of rows()) Object.assign(r, patch);
          return Promise.resolve({ data: rows(), error: null }).then(resolve);
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const payment = { id: "t1", group_id: "g1", user_id: "u1", amount_cents: -1250, is_transfer: false, cost_item_id: "c1" };

describe("filePaymentInCategory", () => {
  it("moves a shop's own bank line to the new category", async () => {
    const line = { id: "c1", group_id: "g1", name: "The Cookie Box", category: "other", bank_source: "up" };
    const admin = fakeAdmin({ bank_transactions: [{ ...payment }], cost_items: [line] });
    const res = await filePaymentInCategory({ admin, userId: "u1", groupId: "g1" }, "t1", "outing");
    expect(res).toEqual({ ok: { costItemId: "c1", name: "The Cookie Box", movedLine: true } });
    expect(line.category).toBe("outing");
  });

  it("leaves a payment alone when its line is already in that category", async () => {
    const line = { id: "c1", group_id: "g1", name: "Dinners", category: "outing", bank_source: null };
    const admin = fakeAdmin({ bank_transactions: [{ ...payment }], cost_items: [line] });
    const res = await filePaymentInCategory({ admin, userId: "u1", groupId: "g1" }, "t1", "outing");
    expect(res).toEqual({ ok: { costItemId: "c1", name: "Dinners", movedLine: false } });
  });

  it("refuses someone else's payment", async () => {
    const admin = fakeAdmin({ bank_transactions: [{ ...payment, user_id: "u2" }], cost_items: [] });
    const res = await filePaymentInCategory({ admin, userId: "u1", groupId: "g1" }, "t1", "outing");
    expect(res).toMatchObject({ status: 403 });
  });
});

describe("moveShopToCategory", () => {
  it("leaves payments the caller can't see alone", async () => {
    const shop = { group_id: "g1", description: "Corner Pharmacy", amount_cents: -900, occurred_at: new Date().toISOString(), is_transfer: false, cost_category: null };
    const mine = { ...shop, id: "t1", user_id: "u1", source: "up", external_id: "e1", cost_item_id: "groceries" };
    const theirs = { ...shop, id: "t2", user_id: "u2", source: "up", external_id: "e2", cost_item_id: "health" };
    const lines = [
      { id: "groceries", group_id: "g1", name: "Groceries", provider: null, bank_source: null, deleted: false },
      { id: "health", group_id: "g1", name: "Health", provider: null, bank_source: null, deleted: false },
    ];
    const admin = fakeAdmin({ bank_transactions: [mine, theirs], cost_items: lines });
    const res = await moveShopToCategory({ admin, userId: "u1", groupId: "g1" }, "Corner Pharmacy", "outing");
    expect(res).toEqual({ ok: { costItemId: null, ids: ["t1"] } });
    expect(mine.cost_category).toBe("outing");
    expect(theirs.cost_category).toBeNull();
  });
});
