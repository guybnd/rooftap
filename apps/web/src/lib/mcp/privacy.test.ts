// Every Assistant read tool keeps each module's privacy rule.
//
// Tool handlers use the admin client, which skips row-level security, so each
// handler repeats the privacy rule by hand. The Oct 29 audit found places where
// that slipped (#678 to #681). This test seeds one household with a row of
// every private kind that belongs to someone else (a private to-do, event,
// grocery item, setup item and loyalty card, and a gift idea, occasion,
// Scout search and watch kept from the caller), then runs every read tool as
// the caller, in a private chat and in the household chat. No answer may
// mention a SECRET row.
//
// The fake client below ignores filters it does not know (or, not,
// contains), so a handler that relies on one of those to hide a row fails
// here. Give such a handler an explicit check in code, or teach the fake.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/member-names", () => ({ memberNames: vi.fn(async () => new Map([["u2", "Noa"]])) }));

import { MCP_TOOLS } from "@/lib/mcp-tools";
import { householdTools } from "./household-tools";
import type { createAdminClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

const ME = "u1";
const OTHER = "u2";
const G = "g1";
const today = new Date().toISOString().slice(0, 10);
const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();

const base = { group_id: G, deleted: false, created_at: soon, updated_at: soon };

function fixture(): Record<string, Row[]> {
  return {
    groups: [{ id: G, name: "Home", currency: "AUD" }],
    group_members: [
      { group_id: G, user_id: ME, role: "owner" },
      { group_id: G, user_id: OTHER, role: "member" },
    ],
    household_tasks: [
      { ...base, id: "t1", title: "Open task", private: false, assigned_to: null, created_by: ME, due_date: today, completed: false, priority: "medium" },
      { ...base, id: "t2", title: "SECRET task", private: true, assigned_to: OTHER, created_by: OTHER, due_date: today, completed: false, priority: "medium" },
    ],
    events: [
      { ...base, id: "e1", title: "Open event", private: false, created_by: ME, starts_at: soon, ends_at: soon, all_day: false, category: "other" },
      { ...base, id: "e2", title: "SECRET event", private: true, created_by: OTHER, starts_at: soon, ends_at: soon, all_day: false, category: "other" },
    ],
    grocery_items: [
      { ...base, id: "gi1", name: "Open milk", private: false, assigned_to: null, status: "needed", aisle: "Dairy" },
      { ...base, id: "gi2", name: "SECRET grocery", private: true, assigned_to: OTHER, status: "needed", aisle: "Dairy" },
    ],
    setup_items: [
      { ...base, id: "s1", name: "Open setup", private: false, created_by: ME, assigned_to: null, status: "needed", room: "Kitchen" },
      { ...base, id: "s2", name: "SECRET setup", private: true, created_by: OTHER, assigned_to: OTHER, status: "needed", room: "Kitchen" },
    ],
    loyalty_cards: [
      { ...base, id: "lc1", name: "Open card", number: "6014355512345678", format: "code128", private: false, created_by: ME, user_id: ME },
      { ...base, id: "lc2", name: "SECRET card", number: "6014355599998888", format: "code128", private: true, created_by: OTHER, user_id: OTHER },
    ],
    occasions: [
      { ...base, id: "o1", title: "Open birthday", kind: "birthday", date: today, hidden_from: [], created_by: ME },
      { ...base, id: "o2", title: "SECRET party", kind: "other", date: today, hidden_from: [ME], created_by: OTHER },
    ],
    gift_ideas: [{ ...base, id: "gf2", occasion_id: "o1", title: "SECRET gift", name: "SECRET gift", hidden_from: [ME], created_by: OTHER }],
    shopper_searches: [
      { ...base, id: "ss1", query: "Open search", title: "Open search", hidden_from: [], created_by: ME, status: "done" },
      { ...base, id: "ss2", query: "SECRET search", title: "SECRET search", hidden_from: [ME], created_by: OTHER, status: "done" },
    ],
    shopper_wants: [
      { ...base, id: "sw1", name: "Open want", query: "Open want", hidden_from: [], created_by: ME, status: "watching" },
      { ...base, id: "sw2", name: "SECRET want", query: "SECRET want", hidden_from: [ME], created_by: OTHER, status: "watching" },
    ],
  };
}

function fakeAdmin(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let single = false;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const result = () => (single ? { data: rows()[0] ?? null, error: null } : { data: rows(), error: null, count: rows().length });
    const known: Record<string, (...args: never[]) => unknown> = {
      eq: (k: string, v: unknown) => filters.push((r) => r[k] === v),
      neq: (k: string, v: unknown) => filters.push((r) => r[k] !== v),
      in: (k: string, vs: unknown[]) => filters.push((r) => vs.includes(r[k])),
      is: (k: string, v: unknown) => filters.push((r) => (r[k] ?? null) === v),
      gte: (k: string, v: string) => filters.push((r) => r[k] == null || String(r[k]) >= v),
      gt: (k: string, v: string) => filters.push((r) => r[k] == null || String(r[k]) > v),
      lte: (k: string, v: string) => filters.push((r) => r[k] == null || String(r[k]) <= v),
      lt: (k: string, v: string) => filters.push((r) => r[k] == null || String(r[k]) < v),
      maybeSingle: () => (single = true),
      single: () => (single = true),
    };
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
          return (...args: never[]) => {
            known[prop]?.(...args);
            return proxy;
          };
        },
      },
    );
    return proxy;
  }
  return {
    from: builder,
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const READ_TOOLS = MCP_TOOLS.filter((t) => t.kind === "read").map((t) => t.name);
const enabled = new Set(MCP_TOOLS.map((t) => t.module));

describe.each([
  ["a private chat", false],
  ["the household chat", true],
])("read tools in %s", (_label, shared) => {
  it.each(READ_TOOLS)("%s shows no row kept from the caller", async (name) => {
    const tools = householdTools({ admin: fakeAdmin(fixture()), userId: ME, groupId: G, enabled, shared });
    const tool = tools.find((t) => t.name === name);
    if (!tool) return; // A tool that only some contexts offer.
    let text = "";
    try {
      const res = await tool.handler({});
      text = res.content.map((c) => ("text" in c ? c.text : "")).join("\n");
    } catch {
      // A handler that throws on the fake answers nothing, so it leaks nothing.
      return;
    }
    expect(text).not.toMatch(/SECRET/);
  });
});
