import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { filePaymentInCategory } from "./bank-actions";

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
        update: (p: Row) => ((patch = p), b),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: { error: null }) => unknown) => {
          if (patch) for (const r of rows()) Object.assign(r, patch);
          return Promise.resolve({ error: null }).then(resolve);
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
