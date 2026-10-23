import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const posted: { groupId: string; text: string; marker: string }[] = [];

vi.mock("@/lib/assistant/service", () => ({
  postHouseholdRoutine: vi.fn(async (_admin: unknown, groupId: string, text: string, opts: { marker: string }) => {
    posted.push({ groupId, text, marker: opts.marker });
    return { conversation: { id: "c" }, message: { id: "m" } };
  }),
}));
vi.mock("@/lib/assistant/reads", () => ({ notifyHousehold: vi.fn(async () => 0) }));
vi.mock("@/lib/cost-month-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cost-month-server")>()),
  householdCostMonths: vi.fn(async (_admin: unknown, _userId: string, _groupId: string, keysFor: (now: Date) => string[]) => {
    const { costMonths } = await import("@homeup/core");
    const now = new Date(2026, 10, 1);
    const items = [
      {
        id: "rent", group_id: "g1", name: "Rent", category: "rent", amount: 200_000, cadence: "monthly", is_estimate: false,
        start_date: "2026-01-03", end_date: null, discount_end_date: null, provider: null, assigned_to: null, linked_section: null,
        notes: null, sort_order: 0, created_by: null, created_at: "", updated_at: "", deleted: false,
      },
    ];
    return { months: costMonths({ items: items as never, ledger: [], now }, keysFor(now)), items, goalCents: 300_000, now, marks: {} };
  }),
}));
vi.mock("@/lib/up-bank", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/up-bank")>()),
  upBankAllowed: vi.fn(async () => true),
  visibleBankTransactions: vi.fn(async () => []),
  visibleBankAccounts: vi.fn(async () => []),
  bankLinkRows: vi.fn(async () => []),
}));

import { runMoneySummaries } from "./money-summaries";

type Row = Record<string, unknown>;

function fakeAdmin(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    tables[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    const rows = () => tables[table].filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null }),
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const ON = ["assistant", "costs"].map((module_id) => ({ group_id: "g1", module_id, enabled: true }));
// 1 Nov 2026 is a Sunday: both notes are due in UTC.
const SUNDAY_THE_1ST = new Date(Date.UTC(2026, 10, 1, 22));

describe("runMoneySummaries", () => {
  beforeEach(() => {
    posted.length = 0;
  });

  it("posts what each person asked for, on its day", async () => {
    const admin = fakeAdmin({
      user_settings: [{ user_id: "u1", timezone: "UTC", money_summaries: { monthly: true } }],
      group_members: [{ group_id: "g1", user_id: "u1" }],
      group_modules: ON,
    });
    const run = await runMoneySummaries(admin, { available: null, now: SUNDAY_THE_1ST });
    expect(run).toEqual({ households: 1, posted: 1, failed: 0 });
    expect(posted[0].marker).toBe("**Your month in money");
    expect(posted[0].text).toContain("**Your month in money (October):** $2,000 spent, $1,000 under your $3,000 goal.");

    posted.length = 0;
    await runMoneySummaries(admin, { available: null, now: new Date(Date.UTC(2026, 10, 2, 22)) });
    expect(posted).toEqual([]);
  });

  it("follows the person's clock, not the server's", async () => {
    const admin = fakeAdmin({
      // In Sydney it's already 2 November (a Monday): nothing is due.
      user_settings: [{ user_id: "u1", timezone: "Australia/Sydney", money_summaries: { weekly: true, monthly: true } }],
      group_members: [{ group_id: "g1", user_id: "u1" }],
      group_modules: ON,
    });
    await runMoneySummaries(admin, { available: null, now: SUNDAY_THE_1ST });
    expect(posted).toEqual([]);
  });

  it("keeps the weekly bank digest for someone sharing Up who never set the switch, and lets the switch turn it off", async () => {
    const conn = { user_id: "u2", group_id: "g1", shared: true, share_mode: "joint", weekly_digest: true };
    const tables = {
      up_bank_connections: [conn],
      user_settings: [{ user_id: "u2", timezone: "UTC", money_summaries: null }] as Row[],
      group_modules: ON,
    };
    const run = await runMoneySummaries(fakeAdmin(tables), { available: null, kinds: ["weekly"], anyDay: true, now: SUNDAY_THE_1ST });
    expect(run.households).toBe(1);

    tables.user_settings = [{ user_id: "u2", timezone: "UTC", money_summaries: { weekly: false } }];
    const off = await runMoneySummaries(fakeAdmin(tables), { available: null, kinds: ["weekly"], anyDay: true, now: SUNDAY_THE_1ST });
    expect(off.households).toBe(0);
  });

  it("stays quiet when Money insights is off", async () => {
    const admin = fakeAdmin({
      user_settings: [{ user_id: "u1", timezone: "UTC", money_summaries: { monthly: true } }],
      group_members: [{ group_id: "g1", user_id: "u1" }],
      group_modules: [...ON, { group_id: "g1", module_id: "money-insights", enabled: false }],
    });
    await runMoneySummaries(admin, { available: null, now: SUNDAY_THE_1ST });
    expect(posted).toEqual([]);
  });
});
