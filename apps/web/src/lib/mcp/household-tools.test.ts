import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/member-names", () => ({ memberNames: vi.fn(async () => new Map([["u2", "Noa"]])) }));

import { MCP_TOOLS } from "@/lib/mcp-tools";
import { costCategoryFrom, householdTools } from "./household-tools";
import type { createAdminClient } from "@/lib/supabase/admin";

const ctx = {
  admin: {} as ReturnType<typeof createAdminClient>,
  userId: "u1",
  groupId: null,
  enabled: new Set(MCP_TOOLS.map((t) => t.module)),
};

describe("householdTools", () => {
  it("lists exactly the tools in MCP_TOOLS, once each", () => {
    const names = householdTools(ctx).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
  });

  it("gives every tool a description and every write tool an input schema", () => {
    const writes = new Set(MCP_TOOLS.filter((t) => t.kind === "write").map((t) => t.name));
    for (const t of householdTools(ctx)) {
      expect(t.description.length).toBeGreaterThan(0);
      if (writes.has(t.name)) expect(t.inputSchema).toBeDefined();
    }
  });

  it("refuses writes without a household", async () => {
    const create = householdTools(ctx).find((t) => t.name === "create_task")!;
    const result = await create.handler({ title: "x" });
    expect(result.isError).toBe(true);
  });
});

// A tiny in-memory stand-in for the admin client: eq/in filter rows, update
// patches the matching rows, insert appends. Enough to drive the handlers.
type Row = Record<string, unknown>;
function fakeAdmin(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: "select" } | { kind: "update"; patch: Row } | { kind: "insert"; row: Row } = { kind: "select" };
    const rows = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      update: (patch: Row) => ((op = { kind: "update", patch }), b),
      insert: (row: Row) => ((op = { kind: "insert", row }), b),
      then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
        if (op.kind === "insert") (tables[table] ??= []).push(op.row);
        if (op.kind === "update") for (const r of rows()) Object.assign(r, (op as { patch: Row }).patch);
        return Promise.resolve({ data: op.kind === "select" ? rows() : null, error: null }).then(resolve);
      },
    };
    return b;
  }
  return { from: builder } as unknown as ReturnType<typeof createAdminClient>;
}

const run = async (tables: Record<string, Row[]>, name: string, args: Row, enabled = ctx.enabled) => {
  const t = householdTools({ ...ctx, admin: fakeAdmin(tables), groupId: "g1", enabled }).find((x) => x.name === name)!;
  const res = await t.handler(args);
  return { res, body: JSON.parse(res.content[0].text) };
};

describe("recipe tools", () => {
  const base = () => ({
    recipes: [
      { id: "r1", group_id: "g1", title: "Lasagna", cuisines: ["Italian"], method: "baking", instructions: "Boil\nLayer", draft: false, deleted: false },
      { id: "r2", group_id: "g2", title: "Other house soup", cuisines: [], method: null, instructions: null, draft: false, deleted: false },
    ],
    recipe_ingredients: [
      { id: "i1", recipe_id: "r1", group_id: "g1", name: "250 g mince", item_name: "mince", quantity: 250, unit: "g", position: 0, deleted: false },
      { id: "i2", recipe_id: "r1", group_id: "g1", name: "lasagna sheets", item_name: null, quantity: null, unit: null, position: 1, deleted: false },
      { id: "i3", recipe_id: "r1", group_id: "g1", name: "milk", item_name: null, quantity: 1, unit: "l", position: 2, deleted: false },
    ],
    grocery_items: [
      { id: "g-milk", group_id: "g1", name: "Milk", status: "have", private: false, assigned_to: null, deleted: false },
      { id: "g-mince", group_id: "g1", name: "mince", status: "needed", private: false, assigned_to: null, deleted: false },
    ],
  });

  it("finds this household's recipes by ingredient, never another's", async () => {
    const { body } = await run(base(), "get_recipes", { query: "mince" });
    expect(body.map((r: Row) => r.title)).toEqual(["Lasagna"]);
    const { body: all } = await run(base(), "get_recipes", {});
    expect(all).toHaveLength(1);
  });

  it("returns one recipe in full with its steps", async () => {
    const { body } = await run(base(), "get_recipes", { recipe_id: "r1" });
    expect(body.steps).toEqual(["Boil", "Layer"]);
    expect(body.ingredients[0]).toEqual({ name: "250 g mince", quantity: 250, unit: "g" });
  });

  it("adds only the missing ingredients to the grocery list", async () => {
    const tables = base();
    const { body } = await run(tables, "add_recipe_to_groceries", { recipe_id: "r1" });
    expect(body.added).toEqual(["lasagna sheets"]);
    expect(body.skipped.map((s: Row) => s.reason)).toEqual(["already on the list", "in stock"]);
    const added = tables.grocery_items.find((g) => g.name === "lasagna sheets")!;
    expect(added).toMatchObject({ status: "needed", recipe_note: "for Lasagna", recipe_source_id: "r1", group_id: "g1" });
  });

  it("refuses a recipe from another household", async () => {
    const { res } = await run(base(), "add_recipe_to_groceries", { recipe_id: "r2" });
    expect(res.isError).toBe(true);
  });
});

describe("checklist tools", () => {
  const base = () => ({
    checklists: [{ id: "c1", group_id: "g1", title: "Packing", type: "plain", completed_at: null, linked_task_id: "t1", log_costs: false, deleted: false }],
    checklist_task_items: [
      { id: "a", checklist_id: "c1", group_id: "g1", label: "Passports", is_done: true, order: 0, cost_cents: null, linked_cost_item_id: null, deleted: false },
      { id: "b", checklist_id: "c1", group_id: "g1", label: "Chargers", is_done: false, order: 1, cost_cents: null, linked_cost_item_id: null, deleted: false },
    ],
    household_tasks: [{ id: "t1", group_id: "g1", done: false, completed_at: null }],
  });

  it("ticking the last item completes the list and its to-do", async () => {
    const tables = base();
    const { body } = await run(tables, "check_checklist_item", { item_id: "b" });
    expect(body.checklist_complete).toBe(true);
    expect(tables.checklist_task_items[1]).toMatchObject({ is_done: true, checked_by: "u1" });
    expect(tables.checklists[0].completed_at).toBeTruthy();
    expect(tables.household_tasks[0].done).toBe(true);
  });

  it("adding an item appends it and reopens a finished list", async () => {
    const tables = base();
    tables.checklists[0].completed_at = "2026-10-20T00:00:00Z" as never;
    await run(tables, "add_checklist_item", { checklist_id: "c1", label: "Snacks" });
    expect(tables.checklist_task_items[2]).toMatchObject({ label: "Snacks", order: 2, is_done: false });
    expect(tables.checklists[0].completed_at).toBeNull();
  });

  it("lists open checklists with their items", async () => {
    const { body } = await run(base(), "get_checklists", {});
    expect(body[0].items.map((i: Row) => i.label)).toEqual(["Passports", "Chargers"]);
  });
});

describe("task tools", () => {
  const bins = (over: Row = {}) => ({
    id: "t1",
    group_id: "g1",
    title: "Put the bins out",
    due_date: "2026-10-20",
    due_time: null,
    offset_days: null,
    recurrence_days: 7,
    done: false,
    completed_at: null,
    assigned_to: "u1",
    private: false,
    template_key: null,
    notes: null,
    sort_order: 0,
    priority: "medium",
    deleted: false,
    ...over,
  });

  it("creates a repeating to-do", async () => {
    const tables: Record<string, Row[]> = { household_tasks: [] };
    await run(tables, "create_task", { title: "Bins", due_date: "2026-10-27", repeat_every_days: 7 });
    expect(tables.household_tasks[0]).toMatchObject({ title: "Bins", recurrence_days: 7 });
  });

  it("sets and stops a repeat on update", async () => {
    const tables: Record<string, Row[]> = { household_tasks: [bins({ recurrence_days: null })] };
    await run(tables, "update_task", { task_id: "t1", repeat_every_days: 14 });
    expect(tables.household_tasks[0].recurrence_days).toBe(14);
    await run(tables, "update_task", { task_id: "t1", repeat_every_days: null });
    expect(tables.household_tasks[0].recurrence_days).toBeNull();
  });

  it("ticking off a repeating to-do makes the next one, once", async () => {
    const tables: Record<string, Row[]> = { household_tasks: [bins()] };
    const { body } = await run(tables, "complete_task", { task_id: "t1", done: true });
    expect(tables.household_tasks[0]).toMatchObject({ done: true, completed_by: "u1" });
    expect(tables.household_tasks).toHaveLength(2);
    expect(tables.household_tasks[1]).toMatchObject({ title: "Put the bins out", recurrence_days: 7, done: false });
    expect(tables.household_tasks[1]).not.toHaveProperty("created_at");
    expect(body.next.id).toBe(tables.household_tasks[1].id);
    await run(tables, "complete_task", { task_id: "t1", done: true });
    expect(tables.household_tasks).toHaveLength(2);
  });

  it("says who ticked off a to-do, newest first, and filters by title", async () => {
    const tables: Record<string, Row[]> = {
      household_tasks: [
        bins({ id: "a", done: true, completed_at: "2026-10-13T08:00:00Z", completed_by: "u1" }),
        bins({ id: "b", done: true, completed_at: "2026-10-20T08:00:00Z", completed_by: "u2" }),
        bins({ id: "c", title: "Water plants", done: true, completed_at: "2026-10-21T08:00:00Z" }),
      ],
    };
    const { body } = await run(tables, "get_tasks", { done: true, search: "BINS" });
    expect(body.map((t: Row) => [t.id, t.completed_by])).toEqual([
      ["b", "Noa"],
      ["a", "you"],
    ]);
    const since = await run(tables, "get_tasks", { done: true, completed_since: "2026-10-20" });
    expect(since.body.map((t: Row) => t.id)).toEqual(["c", "b"]);
  });

  it("lists what's due and overdue in the agenda", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const day = (n: number) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);
    const tables: Record<string, Row[]> = {
      household_tasks: [
        bins({ id: "late", due_date: day(-2) }),
        bins({ id: "soon", due_date: day(3) }),
        bins({ id: "far", due_date: day(20) }),
        bins({ id: "undated", due_date: null }),
      ],
    };
    const { body } = await run(tables, "get_agenda", { days: 7 }, new Set(["household"]) as typeof ctx.enabled);
    expect(body.overdue_tasks.map((t: Row) => t.id)).toEqual(["late"]);
    expect(body.tasks.map((t: Row) => t.id)).toEqual(["soon"]);
    expect(body).not.toHaveProperty("events");
    expect(body).not.toHaveProperty("bills");
  });
});

describe("costCategoryFrom", () => {
  it("reads a category by id or label, any case", () => {
    expect(costCategoryFrom("outing")).toBe("outing");
    expect(costCategoryFrom(" Going out ")).toBe("outing");
    expect(costCategoryFrom("GROCERIES")).toBe("grocery_estimate");
    expect(costCategoryFrom("Snacks")).toBeNull();
  });
});
