import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_MODULE_IDS, reminderKey, type ModuleId } from "@homeup/core";

// Drives the assembled tool-handler seam (route.ts's admin.from(table).eq("group_id", groupId)
// query, then the visibleTasks/visibleEvents re-filter) end-to-end through the real POST handler.
// The fixture stub applies each recorded .eq() call against the fixture rows, so a handler that
// dropped the group_id scoping (or forgot the deleted/private filter) would leak the wrong rows
// here and fail the assertions below — this is the regression guard AC bullet 4 asks for.
const AUTH_USER_ID = "user-a";
const OTHER_USER_ID = "user-b";
const GROUP_ID = "group-a";
const OTHER_GROUP_ID = "group-b";

const TASKS = [
  { id: "t-visible", group_id: GROUP_ID, assigned_to: null, private: false, deleted: false, title: "Visible task" },
  { id: "t-deleted", group_id: GROUP_ID, assigned_to: null, private: false, deleted: true, title: "Deleted task" },
  { id: "t-private-other", group_id: GROUP_ID, assigned_to: OTHER_USER_ID, private: true, deleted: false, title: "Private task (not mine)" },
  { id: "t-cross-group", group_id: OTHER_GROUP_ID, assigned_to: null, private: false, deleted: false, title: "Other household's task" },
  // A bill reminder belongs to Costs (.docs/modules.md): it goes when Costs is off.
  { id: "t-bill", group_id: GROUP_ID, assigned_to: null, private: false, deleted: false, title: "Pay rent", template_key: reminderKey("cost", "c-visible", "contract") },
];

// The household's module switches; every module is on unless a test turns one off.
let moduleOff: ModuleId[] = [];
afterEach(() => {
  moduleOff = [];
});
const moduleRows = () =>
  ALL_MODULE_IDS.map((id) => ({ group_id: GROUP_ID, module_id: id, enabled: !moduleOff.includes(id) }));

const EVENTS = [
  { id: "e-visible", group_id: GROUP_ID, created_by: null, private: false, deleted: false, title: "Visible event", starts_at: "2026-08-01T00:00:00.000Z" },
  { id: "e-deleted", group_id: GROUP_ID, created_by: null, private: false, deleted: true, title: "Deleted event", starts_at: "2026-08-01T00:00:00.000Z" },
  { id: "e-private-other", group_id: GROUP_ID, created_by: OTHER_USER_ID, private: true, deleted: false, title: "Private event (not mine)", starts_at: "2026-08-01T00:00:00.000Z" },
  { id: "e-cross-group", group_id: OTHER_GROUP_ID, created_by: null, private: false, deleted: false, title: "Other household's event", starts_at: "2026-08-01T00:00:00.000Z" },
];

// Cost items carry no per-user `private` flag (group members can manage any
// group cost line), so unlike TASKS/EVENTS there is no "not-mine" fixture row.
const COST_ITEMS = [
  { id: "c-visible", group_id: GROUP_ID, deleted: false, name: "Visible cost", category: "other", amount: 1000, cadence: "one_off" },
  { id: "c-deleted", group_id: GROUP_ID, deleted: true, name: "Deleted cost", category: "other", amount: 500, cadence: "one_off" },
  { id: "c-cross-group", group_id: OTHER_GROUP_ID, deleted: false, name: "Other household's cost", category: "other", amount: 2000, cadence: "one_off" },
];

const GROCERY_ITEMS = [
  { id: "g-visible", group_id: GROUP_ID, assigned_to: null, private: false, deleted: false, name: "Visible item", status: "needed" },
  { id: "g-deleted", group_id: GROUP_ID, assigned_to: null, private: false, deleted: true, name: "Deleted item", status: "needed" },
  { id: "g-private-other", group_id: GROUP_ID, assigned_to: OTHER_USER_ID, private: true, deleted: false, name: "Private item (not mine)", status: "needed" },
  { id: "g-cross-group", group_id: OTHER_GROUP_ID, assigned_to: null, private: false, deleted: false, name: "Other household's item", status: "needed" },
];

// Chainable stub that actually applies every recorded .eq() call against the fixture rows
// (equality filter), so the group-scoping itself is regression-guarded, not just asserted-on.
function chainable(rows: Record<string, unknown>[], singleRow: unknown) {
  let filtered = rows;
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val);
      return builder;
    },
    limit: () => builder,
    gte: () => builder,
    lte: () => builder,
    update: () => builder,
    insert: () => builder,
    single: async () => ({ data: singleRow, error: null }),
    maybeSingle: async () => ({ data: singleRow, error: null }),
    then: (resolve: (v: { data: unknown; error: null }) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: filtered, error: null }).then(resolve, reject),
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // pat_rate_limit_hit: always within budget here (route.limits.test.ts covers 429).
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => {
      if (table === "personal_access_tokens") {
        return chainable([], { id: "pat-1", user_id: AUTH_USER_ID, revoked_at: null });
      }
      if (table === "group_members") {
        return chainable([], { group_id: GROUP_ID });
      }
      // No row -> getMcpSettings (src/lib/mcp-settings.ts) fails safe to
      // enabled + all tools, matching this suite's "everything registered" assumption.
      if (table === "user_settings") {
        return chainable([], null);
      }
      if (table === "group_modules") {
        return chainable(moduleRows(), null);
      }
      if (table === "household_tasks") {
        return chainable(TASKS, null);
      }
      if (table === "events") {
        return chainable(EVENTS, null);
      }
      if (table === "cost_items") {
        return chainable(COST_ITEMS, null);
      }
      if (table === "grocery_items") {
        return chainable(GROCERY_ITEMS, null);
      }
      throw new Error(`unexpected table in isolation test: ${table}`);
    },
  }),
}));

import { POST } from "./route";

function toolCallRequest(name: string, args: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer houp_pat_isolation-test-token",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const res = await POST(toolCallRequest(name, args));
  expect(res.status).toBe(200);
  const body = await res.json();
  return JSON.parse(body.result.content[0].text);
}

describe("MCP tool handlers — cross-household isolation and visibility (assembled seam)", () => {
  it("get_tasks returns only the in-group, non-deleted, visible-to-me tasks", async () => {
    const tasks = await callTool("get_tasks");
    expect(tasks.map((t: { id: string }) => t.id)).toEqual(["t-visible", "t-bill"]);
  });

  it("get_upcoming_calendar_events returns only the in-group, non-deleted, visible-to-me event", async () => {
    const events = await callTool("get_upcoming_calendar_events");
    expect(events.map((e: { id: string }) => e.id)).toEqual(["e-visible"]);
  });

  it("get_grocery_items returns only the in-group, non-deleted, visible-to-me item", async () => {
    const items = await callTool("get_grocery_items");
    expect(items.map((i: { id: string }) => i.id)).toEqual(["g-visible"]);
  });
});

describe("MCP write-tool handlers — group scoping and visibility (HOUP-9)", () => {
  it("create_task scopes the new row to the caller's group and assigns it to the caller", async () => {
    const task = await callTool("create_task", { title: "Buy milk" });
    expect(task.group_id).toBe(GROUP_ID);
    expect(task.assigned_to).toBe(AUTH_USER_ID);
    expect(task.title).toBe("Buy milk");
    expect(task.done).toBe(false);
    expect(task.deleted).toBe(false);
  });

  it("update_task succeeds on a task visible to the caller", async () => {
    const result = await callTool("update_task", { task_id: "t-visible", title: "Renamed" });
    expect(result).toEqual({ ok: true, id: "t-visible" });
  });

  it("update_task refuses a task from another household (group scoping)", async () => {
    const result = await callTool("update_task", { task_id: "t-cross-group", title: "Renamed" });
    expect(result.error).toBe("Task not found");
  });

  it("update_task refuses another member's private task (visibility)", async () => {
    const result = await callTool("update_task", { task_id: "t-private-other", title: "Renamed" });
    expect(result.error).toBe("Task not found");
  });

  it("complete_task marks a visible task done and stamps completed_at", async () => {
    const result = await callTool("complete_task", { task_id: "t-visible", done: true });
    expect(result).toEqual({ ok: true, id: "t-visible", done: true });
  });

  it("complete_task refuses a task from another household", async () => {
    const result = await callTool("complete_task", { task_id: "t-cross-group", done: true });
    expect(result.error).toBe("Task not found");
  });

  it("delete_task soft-deletes a visible task", async () => {
    const result = await callTool("delete_task", { task_id: "t-visible" });
    expect(result).toEqual({ ok: true, id: "t-visible" });
  });

  it("delete_task refuses another member's private task", async () => {
    const result = await callTool("delete_task", { task_id: "t-private-other" });
    expect(result.error).toBe("Task not found");
  });
});

describe("MCP write-tool handlers — cost items, group scoping (HOUP-10)", () => {
  it("create_cost_item scopes the new row to the caller's group and defaults to a one-off, non-estimate line", async () => {
    const item = await callTool("create_cost_item", { name: "New bill", amount: 4200 });
    expect(item.group_id).toBe(GROUP_ID);
    expect(item.name).toBe("New bill");
    expect(item.amount).toBe(4200);
    expect(item.cadence).toBe("one_off");
    expect(item.is_estimate).toBe(false);
    expect(item.created_by).toBe(AUTH_USER_ID);
    expect(item.deleted).toBe(false);
  });

  it("update_cost_item succeeds on a cost item visible to the caller", async () => {
    const result = await callTool("update_cost_item", { cost_item_id: "c-visible", name: "Renamed" });
    expect(result).toEqual({ ok: true, id: "c-visible" });
  });

  it("update_cost_item refuses a cost item from another household (group scoping)", async () => {
    const result = await callTool("update_cost_item", { cost_item_id: "c-cross-group", name: "Renamed" });
    expect(result.error).toBe("Cost item not found");
  });

  it("update_cost_item refuses an already-deleted cost item", async () => {
    const result = await callTool("update_cost_item", { cost_item_id: "c-deleted", name: "Renamed" });
    expect(result.error).toBe("Cost item not found");
  });

  it("delete_cost_item soft-deletes a visible cost item", async () => {
    const result = await callTool("delete_cost_item", { cost_item_id: "c-visible" });
    expect(result).toEqual({ ok: true, id: "c-visible" });
  });

  it("delete_cost_item refuses a cost item from another household", async () => {
    const result = await callTool("delete_cost_item", { cost_item_id: "c-cross-group" });
    expect(result.error).toBe("Cost item not found");
  });
});

describe("MCP write-tool handlers — calendar events, group scoping and visibility (HOUP-11)", () => {
  it("create_event scopes the new row to the caller's group and attributes it to the caller", async () => {
    const event = await callTool("create_event", { title: "Dentist", starts_at: "2026-08-05T09:00:00.000Z" });
    expect(event.group_id).toBe(GROUP_ID);
    expect(event.created_by).toBe(AUTH_USER_ID);
    expect(event.title).toBe("Dentist");
    expect(event.category).toBe("general");
    expect(event.is_all_day).toBe(false);
    expect(event.private).toBe(false);
    expect(event.deleted).toBe(false);
  });

  it("update_event succeeds on an event visible to the caller", async () => {
    const result = await callTool("update_event", { event_id: "e-visible", title: "Renamed" });
    expect(result).toEqual({ ok: true, id: "e-visible" });
  });

  it("update_event refuses an event from another household (group scoping)", async () => {
    const result = await callTool("update_event", { event_id: "e-cross-group", title: "Renamed" });
    expect(result.error).toBe("Event not found");
  });

  it("update_event refuses another member's private event (visibility)", async () => {
    const result = await callTool("update_event", { event_id: "e-private-other", title: "Renamed" });
    expect(result.error).toBe("Event not found");
  });

  it("delete_event soft-deletes a visible event", async () => {
    const result = await callTool("delete_event", { event_id: "e-visible" });
    expect(result).toEqual({ ok: true, id: "e-visible" });
  });

  it("delete_event refuses another member's private event", async () => {
    const result = await callTool("delete_event", { event_id: "e-private-other" });
    expect(result.error).toBe("Event not found");
  });
});

describe("MCP write-tool handlers — grocery items, group scoping and visibility (HOUP-12)", () => {
  it("create_grocery_item scopes the new row to the caller's group and attributes it to the caller", async () => {
    const item = await callTool("create_grocery_item", { name: "Milk" });
    expect(item.group_id).toBe(GROUP_ID);
    expect(item.created_by).toBe(AUTH_USER_ID);
    expect(item.name).toBe("Milk");
    expect(item.aisle).toBe("other");
    expect(item.status).toBe("needed");
    expect(item.private).toBe(false);
    expect(item.deleted).toBe(false);
  });

  it("create_grocery_item attributes a private item to the caller so it stays visible to its creator", async () => {
    const item = await callTool("create_grocery_item", { name: "Diary", private: true });
    expect(item.private).toBe(true);
    expect(item.assigned_to).toBe(AUTH_USER_ID);
  });

  it("update_grocery_item succeeds on an item visible to the caller", async () => {
    const result = await callTool("update_grocery_item", { grocery_item_id: "g-visible", name: "Renamed" });
    expect(result).toEqual({ ok: true, id: "g-visible" });
  });

  it("update_grocery_item refuses an item from another household (group scoping)", async () => {
    const result = await callTool("update_grocery_item", { grocery_item_id: "g-cross-group", name: "Renamed" });
    expect(result.error).toBe("Grocery item not found");
  });

  it("update_grocery_item refuses another member's private item (visibility)", async () => {
    const result = await callTool("update_grocery_item", { grocery_item_id: "g-private-other", name: "Renamed" });
    expect(result.error).toBe("Grocery item not found");
  });

  it("delete_grocery_item soft-deletes a visible item", async () => {
    const result = await callTool("delete_grocery_item", { grocery_item_id: "g-visible" });
    expect(result).toEqual({ ok: true, id: "g-visible" });
  });

  it("delete_grocery_item refuses another member's private item", async () => {
    const result = await callTool("delete_grocery_item", { grocery_item_id: "g-private-other" });
    expect(result.error).toBe("Grocery item not found");
  });
});

describe("MCP task handlers — reminders follow their module (.docs/modules.md)", () => {
  it("with Costs off, get_tasks leaves out bill reminders", async () => {
    moduleOff = ["costs"];
    const tasks = await callTool("get_tasks");
    expect(tasks.map((t: { id: string }) => t.id)).toEqual(["t-visible"]);
  });

  it("with Costs off, the write tools can't find a bill reminder", async () => {
    moduleOff = ["costs"];
    expect((await callTool("complete_task", { task_id: "t-bill", done: true })).error).toBe("Task not found");
    expect((await callTool("update_task", { task_id: "t-bill", title: "Renamed" })).error).toBe("Task not found");
    expect((await callTool("delete_task", { task_id: "t-bill" })).error).toBe("Task not found");
  });

  it("with Costs on, a bill reminder can be completed", async () => {
    expect(await callTool("complete_task", { task_id: "t-bill", done: true })).toEqual({ ok: true, id: "t-bill", done: true });
  });
});
