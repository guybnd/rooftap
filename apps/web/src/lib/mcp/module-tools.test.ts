import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/member-names", () => ({ memberNames: vi.fn(async () => new Map([["u1", "Guy"], ["u2", "Noa"]])) }));

import { addDaysISO, type ModuleId } from "@homeup/core";
import { householdTools } from "./household-tools";
import type { createAdminClient } from "@/lib/supabase/admin";

// The same in-memory stand-in for the admin client as household-tools.test.ts.
type Row = Record<string, unknown>;
function fakeAdmin(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: "select" } | { kind: "update"; patch: Row } | { kind: "insert"; row: Row | Row[] } = { kind: "select" };
    const rows = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), b),
      lte: (k: string, v: string) => (filters.push((r) => String(r[k]) <= v), b),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      update: (patch: Row) => ((op = { kind: "update", patch }), b),
      insert: (row: Row | Row[]) => ((op = { kind: "insert", row }), b),
      then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
        if (op.kind === "insert") (tables[table] ??= []).push(...(Array.isArray(op.row) ? op.row : [op.row]));
        if (op.kind === "update") for (const r of rows()) Object.assign(r, (op as { patch: Row }).patch);
        return Promise.resolve({ data: op.kind === "select" ? rows() : null, error: null }).then(resolve);
      },
    };
    return b;
  }
  return { from: builder } as unknown as ReturnType<typeof createAdminClient>;
}

const ALL = new Set<ModuleId>(["household", "rewards", "bins", "home-care", "shopper", "checklists", "recipes", "meals", "setup", "documents", "search"]);
const today = new Date().toISOString().slice(0, 10);

const run = async (tables: Record<string, Row[]>, name: string, args: Row, enabled: ReadonlySet<ModuleId> = ALL) => {
  const t = householdTools({ admin: fakeAdmin(tables), userId: "u1", groupId: "g1", enabled }).find((x) => x.name === name)!;
  const res = await t.handler(args);
  return { res, body: JSON.parse(res.content[0].text) };
};

const live = { deleted: false };

describe("rewards tools", () => {
  const base = () => ({
    reward_schemes: [{ id: "s1", group_id: "g1", name: "Flybuys", kind: "loyalty", ...live }],
    reward_partners: [{ id: "p1", group_id: "g1", scheme_id: "s1", name: "Kmart", brand_key: "kmart", online_only: false, ...live }],
    reward_perks: [
      { id: "k1", group_id: "g1", scheme_id: "s1", partner_id: "p1", title: "10% off", kind: "percent", value: 10, valid_until: addDaysISO(today, 5), ...live },
    ],
    loyalty_cards: [
      { id: "c1", group_id: "g1", scheme_id: "s1", name: "Flybuys", number: "6014355512345678", format: "code128", private: false, created_by: "u2", ...live },
      { id: "c2", group_id: "g1", scheme_id: "s1", name: "Noa's own", number: "6014355599998888", format: "code128", private: true, created_by: "u2", ...live },
      { id: "c3", group_id: "g2", scheme_id: "s9", name: "Other house", number: "1", format: "qr", private: false, created_by: "u9", ...live },
    ],
  });

  it("finds the card for a store, with only the last digits, and never another member's Just me card", async () => {
    const { body } = await run(base(), "get_rewards", { store: "kmart" });
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].cards).toEqual([{ name: "Flybuys", number: "ending 5678", owner: "Noa" }]);
    expect(body.matches[0].perks[0]).toMatchObject({ title: "10% off", store: "Kmart", ending_soon: true });
    expect(JSON.stringify(body)).not.toContain("6014355512345678");
  });

  it("lists the wallet and perks ending soon without a store", async () => {
    const { body } = await run(base(), "get_rewards", {});
    expect(body.cards.map((c: Row) => c.number)).toEqual(["ending 5678"]);
    expect(body.perks_ending_soon[0]).toMatchObject({ scheme: "Flybuys", title: "10% off" });
  });

  it("saves a perk for a partner store", async () => {
    const tables = base();
    const { body } = await run(tables, "add_reward_perk", { scheme: "flybuys", title: "2x points", kind: "points", value: 2, store: "Kmart" });
    expect(body.ok).toBe(true);
    expect(tables.reward_perks.at(-1)).toMatchObject({ scheme_id: "s1", partner_id: "p1", kind: "points", created_by: "u1" });
    expect(tables.reward_perks.at(-1)).not.toHaveProperty("created_at");
    expect((await run(base(), "add_reward_perk", { scheme: "Everyday", title: "x" })).res.isError).toBe(true);
  });
});

describe("bin night tools", () => {
  const tomorrow = addDaysISO(today, 1);
  const base = () => ({
    bin_streams: [{ id: "red", group_id: "g1", name: "Red", lid: "red", weekday: new Date(`${tomorrow}T00:00:00`).getDay(), every_weeks: 1, anchor_date: tomorrow, sort_order: 0, ...live }],
    bin_changes: [] as Row[],
    bin_plans: [{ id: "plan", group_id: "g1", rotation: ["u2"], rotation_anchor: tomorrow, out_for: null, out_by: null, ...live }],
  });

  it("says tonight is bin night and whose turn it is", async () => {
    const { body } = await run(base(), "get_bin_night", {});
    expect(body.next).toMatchObject({ collection: tomorrow, night_of: today, tonight: true, bins: "Red", turn: "Noa", out: false });
  });

  it("marks the bins out, and back", async () => {
    const tables = base();
    await run(tables, "mark_bins_out", {});
    expect(tables.bin_plans[0]).toMatchObject({ out_for: tomorrow, out_by: "u1" });
    expect((await run(tables, "get_bin_night", {})).body.next).toMatchObject({ out: true, out_by: "you" });
    await run(tables, "mark_bins_out", { out: false });
    expect(tables.bin_plans[0].out_for).toBeNull();
  });

  it("moves a collection", async () => {
    const tables = base();
    await run(tables, "change_bin_collection", { date: tomorrow, moved_to: addDaysISO(tomorrow, 1), note: "Public holiday" });
    const { body } = await run(tables, "get_bin_night", {});
    expect(body.next).toMatchObject({ collection: addDaysISO(tomorrow, 1), notes: ["Public holiday"] });
  });
});

describe("home care tools", () => {
  const base = () => ({
    groups: [{ id: "g1", region: "AU" }],
    care_jobs: [
      { id: "j1", group_id: "g1", title: "Clean aircon filters", area: "climate", room: "Living", suggestion_id: "aircon-filter", state: "active", every_n: 3, every_unit: "month", season_month: null, next_due: addDaysISO(today, -2), last_done: null, assigned_to: null, remind: true, remind_days_before: 0, notes: null, done_log: [], ...live },
    ],
  });

  it("lists jobs with when they are due, and the suggestions left", async () => {
    const { body } = await run(base(), "get_care_jobs", { include_suggestions: true });
    expect(body.jobs[0]).toMatchObject({ id: "j1", every: "every 3 months", due: "2 days overdue" });
    expect(body.suggestions.some((s: Row) => s.suggestion_id === "aircon-filter")).toBe(false);
    expect(body.suggestions.some((s: Row) => s.suggestion_id === "smoke-alarm-test")).toBe(true);
  });

  it("marks a job done and works out the next due date", async () => {
    const tables = base();
    const { body } = await run(tables, "update_care_job", { job_id: "j1", action: "done" });
    expect(tables.care_jobs[0]).toMatchObject({ last_done: today });
    expect(body.next_due > today).toBe(true);
  });

  it("adds a built-in job once", async () => {
    const tables = base();
    expect((await run(tables, "add_care_job", { suggestion_id: "smoke-alarm-test" })).body.ok).toBe(true);
    expect(tables.care_jobs.at(-1)).toMatchObject({ title: "Test smoke alarms", every_n: 6, every_unit: "month", created_by: "u1", group_id: "g1" });
    expect((await run(tables, "add_care_job", { suggestion_id: "smoke-alarm-test" })).res.isError).toBe(true);
  });
});

describe("shopper watch tools", () => {
  const base = () => ({
    shopper_wants: [{ id: "w1", group_id: "g1", title: "Linen robe", status: "watching", hidden_from: ["u1"], ...live }],
  });

  it("adds a watch and refuses one kept from this person", async () => {
    const tables = base();
    const { body } = await run(tables, "watch_item", { title: "Dyson V15", target_cents: 60000 });
    expect(body).toMatchObject({ ok: true, status: "watching" });
    expect(tables.shopper_wants.at(-1)).toMatchObject({ title: "Dyson V15", target_cents: 60000, group_id: "g1" });
    expect((await run(tables, "update_watch_item", { want_id: "w1", status: "bought" })).res.isError).toBe(true);
  });

  it("marks a watch bought", async () => {
    const tables = { shopper_wants: [{ id: "w2", group_id: "g1", title: "Kettle", status: "watching", ...live }] };
    await run(tables, "update_watch_item", { want_id: "w2", status: "bought" });
    expect(tables.shopper_wants[0]).toMatchObject({ status: "bought" });
    expect(tables.shopper_wants[0]).toHaveProperty("bought_at");
  });
});

describe("checklist, recipe and setup tools", () => {
  it("starts a list from a template, adds extra items and a linked to-do", async () => {
    const tables: Record<string, Row[]> = {
      checklist_templates: [{ id: "t1", group_id: "g1", title: "Beach packing", default_type: "plain", template_key: null, ...live }],
      checklist_template_items: [
        { id: "ti1", template_id: "t1", group_id: "g1", label: "Towels", order: 0, ...live },
        { id: "ti2", template_id: "t1", group_id: "g1", label: "Sunscreen", order: 1, ...live },
      ],
    };
    const { body } = await run(tables, "create_checklist", { template_id: "t1", items: ["sunscreen", "Hats"], scheduled_date: "2026-11-01" });
    expect(body).toMatchObject({ ok: true, title: "Beach packing", items: 3 });
    expect(tables.checklist_task_items.map((i) => i.label)).toEqual(["Towels", "Sunscreen", "Hats"]);
    expect(tables.household_tasks[0]).toMatchObject({ title: "Beach packing", due_date: "2026-11-01", linked_checklist_id: body.id });
    expect(tables.checklists[0]).toMatchObject({ linked_task_id: tables.household_tasks[0].id, created_by: "u1" });
  });

  it("saves a recipe with its ingredients, once", async () => {
    const tables: Record<string, Row[]> = {};
    const args = { title: "Risotto", ingredients: [{ name: "2 cups arborio rice", item: "arborio rice", quantity: 2, unit: "cup" }], steps: ["Toast", "Stir"] };
    expect((await run(tables, "save_recipe", args)).body.ok).toBe(true);
    expect(tables.recipes[0]).toMatchObject({ title: "Risotto", instructions: "Toast\nStir", source_type: "manual", group_id: "g1" });
    expect(tables.recipe_ingredients[0]).toMatchObject({ item_name: "arborio rice", position: 0 });
    expect((await run(tables, "save_recipe", args)).res.isError).toBe(true);
  });

  it("adds and changes Setup items, never another member's private one", async () => {
    const tables: Record<string, Row[]> = {
      setup_items: [{ id: "x", group_id: "g1", name: "Secret", room: "Bedroom", private: true, assigned_to: "u2", status: "needed", sort_order: 0, ...live }],
    };
    const { body } = await run(tables, "create_setup_item", { name: "Curtain rail", room: "Bedroom", est_price: 4500 });
    expect(tables.setup_items.at(-1)).toMatchObject({ name: "Curtain rail", status: "needed", sort_order: 1 });
    await run(tables, "update_setup_item", { item_id: body.id, status: "installed", actual_price: 3900 });
    expect(tables.setup_items.at(-1)).toMatchObject({ status: "installed", actual_price: 3900 });
    expect((await run(tables, "update_setup_item", { item_id: "x", status: "installed" })).res.isError).toBe(true);
  });
});

describe("read tools", () => {
  it("finds documents expiring soon, without their details", async () => {
    const tables = {
      documents: [
        { id: "d1", group_id: "g1", filename: "dw.pdf", title: "Dishwasher warranty", doc_type: "warranty", expiry_date: addDaysISO(today, 20), tags: ["kitchen"], metadata: { serial: "SECRET-1" }, folder_id: "f1", created_at: "2026-01-01T00:00:00Z", ...live },
        { id: "d2", group_id: "g1", filename: "lease.pdf", title: "Lease", doc_type: "lease_contract", expiry_date: addDaysISO(today, 400), tags: [], metadata: {}, folder_id: null, created_at: "2026-02-01T00:00:00Z", ...live },
      ],
      document_folders: [{ id: "f1", group_id: "g1", name: "Appliances", parent_id: null }],
    };
    const { body } = await run(tables, "find_documents", { expiring_within_days: 60 });
    expect(body.documents).toEqual([
      { id: "d1", title: "Dishwasher warranty", type: "warranty", expiry_date: addDaysISO(today, 20), tags: ["kitchen"], folder: "Appliances", added: "2026-01-01", link: "/documents?folder=f1" },
    ]);
    expect((await run(tables, "find_documents", { query: "applian" })).body.total).toBe(1);
  });

  it("puts bin night, care jobs and dinners on the agenda", async () => {
    const tomorrow = addDaysISO(today, 1);
    const tables = {
      household_tasks: [] as Row[],
      bin_streams: [{ id: "red", group_id: "g1", name: "Red", lid: "red", weekday: new Date(`${tomorrow}T00:00:00`).getDay(), every_weeks: 1, anchor_date: tomorrow, sort_order: 0, ...live }],
      bin_changes: [] as Row[],
      bin_plans: [] as Row[],
      care_jobs: [{ id: "j1", group_id: "g1", title: "Clean gutters", room: null, state: "active", next_due: tomorrow, done_log: [], ...live }],
      recipes: [{ id: "r1", group_id: "g1", title: "Lasagna", cuisines: [], draft: false, ...live }],
      meal_plan_entries: [{ id: "m1", group_id: "g1", date: today, slot: "dinner", recipe_id: "r1", label: null, cook_user_id: "u2", ...live }],
    };
    const { body } = await run(tables, "get_agenda", { days: 3 });
    expect(body.bin_nights[0]).toMatchObject({ night_of: today, collection: tomorrow, bins: "Red" });
    expect(body.home_care).toEqual([{ id: "j1", title: "Clean gutters", due: tomorrow }]);
    expect(body.dinners).toEqual([{ date: today, dinner: "Lasagna", cook: "Noa" }]);
  });
});
