import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePatUser, checkPatRateLimit, resolveGroupId, visibleTasks, visibleEvents, visibleGroceryItems } from '@/lib/pat';
import { listCostItems, isTaskOwnerEnabled, type ModuleId } from '@homeup/core';
import { totalForPeriod, monthlyAmount, CATEGORY_META } from '@homeup/core';
import { MCP_TOOLS, MCP_TOOL_BY_NAME } from "@/lib/mcp-tools";
import { getMcpSettings, toolAllowed, type McpSettings } from "@/lib/mcp-settings";
import { getEnabledModules, moduleNotFound } from "@/lib/server-modules";
import { checkOAuthRateLimit, isOAuthAccessToken, resolveOAuthUser, wwwAuthenticate } from "@/lib/mcp-oauth";
import type { HouseholdTask, GroupEvent, CostItem, CostCategory, CostCadence, EventCategory, GroceryItem } from '@homeup/core';

const COST_CATEGORIES = Object.keys(CATEGORY_META) as [CostCategory, ...CostCategory[]];
const COST_CADENCES: [CostCadence, ...CostCadence[]] = [
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "yearly",
  "one_off",
];
const EVENT_CATEGORIES: [EventCategory, ...EventCategory[]] = [
  "general",
  "medical",
  "social",
  "household",
  "finance",
  "school",
  "travel",
  "work",
];
const GROCERY_STATUSES: [GroceryItem["status"], ...GroceryItem["status"][]] = ["needed", "have", "bought"];

// Generic, non-enumerating 401 body — identical for missing/malformed/unknown/revoked auth,
// so an external caller can never tell which of those cases they hit.
// The www-authenticate header points sign-in capable clients (Claude and
// other MCP apps) at the OAuth discovery document (lib/mcp-oauth.ts).
function unauthorized(req: Request) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": wwwAuthenticate(new URL(req.url).origin) },
  });
}

function noGroupError() {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: "No household group" }) }], isError: true };
}

function toolError(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

// Fetches a task scoped to this caller's group, then re-applies the same
// deleted/private visibility rule get_tasks uses — the admin client bypasses
// RLS, so this is the only thing stopping a write tool from touching another
// household's task, or another member's private one, by guessing/enumerating an id.
// A bill or document reminder whose module is off doesn't exist either
// (.docs/modules.md), same as in get_tasks.
async function findVisibleTask(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  userId: string,
  taskId: string,
  enabled: ReadonlySet<ModuleId>
): Promise<HouseholdTask | null> {
  const { data } = await admin
    .from("household_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("group_id", groupId)
    .eq("deleted", false);
  return visibleTasks((data ?? []) as HouseholdTask[], userId).find((t) => isTaskOwnerEnabled(t, enabled)) ?? null;
}

// Fetches a cost item scoped to this caller's group — the admin client bypasses
// RLS, so this explicit group_id + deleted=false filter is the only thing
// stopping a write tool from touching another household's cost line by
// guessing/enumerating an id. Unlike tasks/events, cost items carry no
// per-user `private` flag (the RLS policy grants every group member full
// manage access), so there is no further visibleCostItems-style filter to
// re-apply here.
async function findVisibleCostItem(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  costItemId: string
): Promise<CostItem | null> {
  const { data } = await admin
    .from("cost_items")
    .select("*")
    .eq("id", costItemId)
    .eq("group_id", groupId)
    .eq("deleted", false);
  return ((data ?? []) as CostItem[])[0] ?? null;
}

// Fetches a native calendar event scoped to this caller's group, then re-applies
// the same deleted/private visibility rule get_upcoming_calendar_events uses —
// mirrors findVisibleTask's fetch-then-check guard for the same reason (the
// admin client bypasses RLS).
async function findVisibleEvent(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  userId: string,
  eventId: string
): Promise<GroupEvent | null> {
  const { data } = await admin
    .from("events")
    .select("*")
    .eq("id", eventId)
    .eq("group_id", groupId)
    .eq("deleted", false);
  return visibleEvents((data ?? []) as GroupEvent[], userId)[0] ?? null;
}

// Fetches a grocery item scoped to this caller's group, then re-applies the
// same deleted/private visibility rule get_grocery_items uses — mirrors
// findVisibleTask's fetch-then-check guard for the same reason (the admin
// client bypasses RLS, so this is the only thing stopping a write tool from
// touching another household's item, or another member's private one, by
// guessing/enumerating an id).
async function findVisibleGroceryItem(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  userId: string,
  groceryItemId: string
): Promise<GroceryItem | null> {
  const { data } = await admin
    .from("grocery_items")
    .select("*")
    .eq("id", groceryItemId)
    .eq("group_id", groupId)
    .eq("deleted", false);
  return visibleGroceryItems((data ?? []) as GroceryItem[], userId)[0] ?? null;
}

// Read tools answer with the fields everyday questions need unless the agent
// asks for the full row: a household's whole list in every column runs to
// tens of thousands of characters. Basic keeps the id so the agent can still
// edit, and leaves out empty fields.
//   Tasks: what's due or overdue, what's mine, what repeats, what got done.
//   Events: what's on when and where.
//   Groceries: what we need, what we have, what's expiring, what it costs,
//   when we last bought it.
const DETAIL = z
  .enum(["basic", "full"])
  .optional()
  .describe(
    "basic (default) answers everyday questions; a field missing from a basic row is empty. full adds bookkeeping fields (reminders, recipe links, price history, timestamps)."
  );

function basic<T extends object>(row: T, keys: readonly (keyof T)[]): Partial<T> {
  return Object.fromEntries(keys.filter((k) => row[k] != null).map((k) => [k, row[k]])) as Partial<T>;
}

const TASK_BASIC = ["id", "title", "due_date", "due_time", "done", "completed_at", "priority", "notes", "recurrence_days"] as const;
const EVENT_BASIC = ["id", "title", "category", "starts_at", "ends_at", "is_all_day", "location", "notes"] as const;
const GROCERY_BASIC = [
  "id",
  "name",
  "quantity",
  "unit",
  "aisle",
  "status",
  "notes",
  "is_essential",
  "expiry_date",
  "price_cents",
  "last_purchased_at",
] as const;

function buildServer(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  groupId: string | null,
  settings: McpSettings,
  enabled: ReadonlySet<ModuleId>
) {
  const server = new McpServer({ name: "homeup", version: "1.0.0" });
  const registeredNames = new Set<string>();

  // Gates every registerTool call through the household's modules (a
  // switched-off module's tools don't exist) and the settings conjunction
  // (mcp-settings.ts's toolAllowed), and tracks each call site so the
  // dev-only assertion below can catch this file drifting from MCP_TOOLS.
  // registerTool's config/handler types are tied together generically (the
  // handler's argument shape depends on config.inputSchema), which a thin
  // passthrough can't re-derive without duplicating the SDK's generics —
  // so this forwards untyped; each call site below still gets its own
  // typed config object and handler literal checked independently.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function register(name: string, config: Record<string, unknown>, handler: (...args: any[]) => unknown) {
    const tool = MCP_TOOL_BY_NAME[name];
    if (!tool) throw new Error(`Unknown MCP tool "${name}" — add it to MCP_TOOLS in packages/core/src/mcp-tools.ts`);
    registeredNames.add(name);
    if (!enabled.has(tool.module)) return;
    if (!toolAllowed(settings, tool)) return;
    server.registerTool(name, config as never, handler as never);
  }

  register(
    "get_budget_summary",
    { description: "Household budget summary for the current month (costs section)." },
    async () => {
      if (!groupId) return { content: [{ type: "text", text: JSON.stringify({ total: 0, byCategory: {} }) }] };
      const items = await listCostItems(admin, groupId);
      const total = totalForPeriod(items, "monthly");
      const byCategory: Record<string, number> = {};
      for (const item of items) {
        byCategory[item.category] = (byCategory[item.category] ?? 0) + monthlyAmount(item);
      }
      const labeled = Object.fromEntries(
        Object.entries(byCategory).map(([category, amount]) => [
          CATEGORY_META[category as keyof typeof CATEGORY_META]?.label ?? category,
          amount,
        ])
      );
      return { content: [{ type: "text", text: JSON.stringify({ total, byCategory: labeled }) }] };
    }
  );

  register(
    "create_cost_item",
    {
      // Mirrors createOneOffCostItem's defaults (cadence: 'one_off', is_estimate: false) —
      // that helper can't be called directly here since it expects an
      // auth'd browser client (supabase.auth.getUser()), not the admin client.
      description: "Create a new one-off household cost line (a bill or purchase). For recurring/estimate cost lines, use the Costs page.",
      inputSchema: {
        name: z.string().min(1),
        amount: z.number().int().nonnegative().optional(),
        category: z.enum(COST_CATEGORIES).optional(),
        provider: z.string().optional(),
        start_date: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async ({ name, amount, category, provider, start_date, notes }) => {
      if (!groupId) return noGroupError();
      const row: Record<string, unknown> = {
        id: crypto.randomUUID(),
        group_id: groupId,
        name: name.trim() || "Untitled",
        category: category ?? "other",
        amount: amount ?? 0,
        cadence: "one_off",
        is_estimate: false,
        start_date: start_date ?? null,
        end_date: null,
        discount_end_date: null,
        provider: provider ?? null,
        assigned_to: null,
        linked_section: null,
        notes: notes ?? null,
        sort_order: 0,
        created_by: userId,
        deleted: false,
      };
      const { error } = await admin.from("cost_items").insert(row);
      if (error) return toolError(error.message);
      return { content: [{ type: "text", text: JSON.stringify(row) }] };
    }
  );

  register(
    "update_cost_item",
    {
      description: "Update fields on an existing household cost line (name, amount, category, cadence, provider, dates, notes, estimate flag). Only the fields provided are changed; omit a field to leave it as-is.",
      inputSchema: {
        cost_item_id: z.string(),
        name: z.string().min(1).optional(),
        amount: z.number().int().nonnegative().optional(),
        category: z.enum(COST_CATEGORIES).optional(),
        cadence: z.enum(COST_CADENCES).optional(),
        is_estimate: z.boolean().optional(),
        provider: z.string().nullable().optional(),
        start_date: z.string().nullable().optional(),
        end_date: z.string().nullable().optional(),
        discount_end_date: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      },
    },
    async ({ cost_item_id, ...patch }) => {
      if (!groupId) return noGroupError();
      const item = await findVisibleCostItem(admin, groupId, cost_item_id);
      if (!item) return toolError("Cost item not found");
      const updates: Record<string, unknown> = {};
      for (const key of [
        "name",
        "amount",
        "category",
        "cadence",
        "is_estimate",
        "provider",
        "start_date",
        "end_date",
        "discount_end_date",
        "notes",
      ] as const) {
        if (patch[key] !== undefined) updates[key] = patch[key];
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await admin.from("cost_items").update(updates).eq("id", cost_item_id).eq("group_id", groupId);
        if (error) return toolError(error.message);
      }
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, id: cost_item_id }) }] };
    }
  );

  register(
    "delete_cost_item",
    {
      description: "Soft-delete a household cost line.",
      inputSchema: { cost_item_id: z.string() },
    },
    async ({ cost_item_id }) => {
      if (!groupId) return noGroupError();
      const item = await findVisibleCostItem(admin, groupId, cost_item_id);
      if (!item) return toolError("Cost item not found");
      const { error } = await admin.from("cost_items").update({ deleted: true }).eq("id", cost_item_id).eq("group_id", groupId);
      if (error) return toolError(error.message);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, id: cost_item_id }) }] };
    }
  );

  register(
    "get_tasks",
    {
      description:
        "Household to-dos visible to the authenticated user. Pass done false for what's still open. Each task says whether it's assigned to you.",
      inputSchema: { done: z.boolean().optional(), detail: DETAIL },
    },
    async ({ done, detail }) => {
      if (!groupId) return { content: [{ type: "text", text: JSON.stringify([]) }] };
      const { data } = await admin
        .from("household_tasks")
        .select("*")
        .eq("group_id", groupId)
        .eq("deleted", false);
      const tasks = visibleTasks((data ?? []) as HouseholdTask[], userId)
        .filter((t) => isTaskOwnerEnabled(t, enabled))
        .filter((t) => done === undefined || t.done === done);
      const shaped = detail === "full" ? tasks : tasks.map((t) => ({ ...basic(t, TASK_BASIC), assigned_to_me: t.assigned_to === userId }));
      return { content: [{ type: "text", text: JSON.stringify(shaped) }] };
    }
  );

  register(
    "create_task",
    {
      description: "Create a new household to-do, assigned to the authenticated user.",
      inputSchema: {
        title: z.string().min(1),
        due_date: z.string().optional(),
        due_time: z.string().optional(),
        notes: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        private: z.boolean().optional(),
      },
    },
    async ({ title, due_date, due_time, notes, priority, private: isPrivate }) => {
      if (!groupId) return noGroupError();
      const id = crypto.randomUUID();
      const row: Record<string, unknown> = {
        id,
        group_id: groupId,
        title,
        due_date: due_date ?? null,
        due_time: due_time ?? null,
        offset_days: null,
        recurrence_days: null,
        done: false,
        completed_at: null,
        assigned_to: userId,
        private: isPrivate ?? false,
        template_key: null,
        notes: notes ?? null,
        sort_order: 0,
        deleted: false,
      };
      if (priority) row.priority = priority;
      const { error } = await admin.from("household_tasks").insert(row);
      if (error) return toolError(error.message);
      return { content: [{ type: "text", text: JSON.stringify({ ...row, priority: priority ?? "medium" }) }] };
    }
  );

  register(
    "update_task",
    {
      description: "Update fields on an existing household to-do (title, due date/time, notes, priority, private flag). Only the fields provided are changed; omit a field to leave it as-is.",
      inputSchema: {
        task_id: z.string(),
        title: z.string().min(1).optional(),
        due_date: z.string().nullable().optional(),
        due_time: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        private: z.boolean().optional(),
      },
    },
    async ({ task_id, ...patch }) => {
      if (!groupId) return noGroupError();
      const task = await findVisibleTask(admin, groupId, userId, task_id, enabled);
      if (!task) return toolError("Task not found");
      const updates: Record<string, unknown> = {};
      for (const key of ["title", "due_date", "due_time", "notes", "priority", "private"] as const) {
        if (patch[key] !== undefined) updates[key] = patch[key];
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await admin.from("household_tasks").update(updates).eq("id", task_id).eq("group_id", groupId);
        if (error) return toolError(error.message);
      }
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, id: task_id }) }] };
    }
  );

  register(
    "complete_task",
    {
      description: "Mark a household to-do done or not done.",
      inputSchema: { task_id: z.string(), done: z.boolean() },
    },
    async ({ task_id, done }) => {
      if (!groupId) return noGroupError();
      const task = await findVisibleTask(admin, groupId, userId, task_id, enabled);
      if (!task) return toolError("Task not found");
      const { error } = await admin
        .from("household_tasks")
        .update({ done, completed_at: done ? new Date().toISOString() : null })
        .eq("id", task_id)
        .eq("group_id", groupId);
      if (error) return toolError(error.message);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, id: task_id, done }) }] };
    }
  );

  register(
    "delete_task",
    {
      description: "Soft-delete a household to-do.",
      inputSchema: { task_id: z.string() },
    },
    async ({ task_id }) => {
      if (!groupId) return noGroupError();
      const task = await findVisibleTask(admin, groupId, userId, task_id, enabled);
      if (!task) return toolError("Task not found");
      const { error } = await admin
        .from("household_tasks")
        .update({ deleted: true })
        .eq("id", task_id)
        .eq("group_id", groupId);
      if (error) return toolError(error.message);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, id: task_id }) }] };
    }
  );

  register(
    "get_upcoming_calendar_events",
    {
      description: "Upcoming native Rooftap calendar events visible to the authenticated user (excludes the Google Calendar overlay).",
      inputSchema: { days: z.number().int().positive().max(90).optional(), detail: DETAIL },
    },
    async ({ days, detail }) => {
      if (!groupId) return { content: [{ type: "text", text: JSON.stringify([]) }] };
      const now = new Date();
      const until = new Date(now.getTime() + (days ?? 30) * 24 * 60 * 60 * 1000);
      const { data } = await admin
        .from("events")
        .select("*")
        .eq("group_id", groupId)
        .eq("deleted", false)
        .gte("starts_at", now.toISOString())
        .lte("starts_at", until.toISOString());
      const events = visibleEvents((data ?? []) as GroupEvent[], userId);
      const shaped = detail === "full" ? events : events.map((e) => basic(e, EVENT_BASIC));
      return { content: [{ type: "text", text: JSON.stringify(shaped) }] };
    }
  );

  register(
    "create_event",
    {
      description: "Create a new native Rooftap calendar event, attributed to the authenticated user. Does not touch the Google Calendar overlay or appointments.",
      inputSchema: {
        title: z.string().min(1),
        starts_at: z.string(),
        ends_at: z.string().optional(),
        category: z.enum(EVENT_CATEGORIES).optional(),
        is_all_day: z.boolean().optional(),
        location: z.string().optional(),
        notes: z.string().optional(),
        private: z.boolean().optional(),
      },
    },
    async ({ title, starts_at, ends_at, category, is_all_day, location, notes, private: isPrivate }) => {
      if (!groupId) return noGroupError();
      const row: Record<string, unknown> = {
        id: crypto.randomUUID(),
        group_id: groupId,
        created_by: userId,
        title,
        category: category ?? "general",
        starts_at,
        ends_at: ends_at ?? null,
        is_all_day: is_all_day ?? false,
        location: location ?? null,
        notes: notes ?? null,
        private: isPrivate ?? false,
        deleted: false,
      };
      const { error } = await admin.from("events").insert(row);
      if (error) return toolError(error.message);
      return { content: [{ type: "text", text: JSON.stringify(row) }] };
    }
  );

  register(
    "update_event",
    {
      description: "Update fields on an existing native Rooftap calendar event (title, times, category, all-day flag, location, notes, private flag). Only the fields provided are changed; omit a field to leave it as-is.",
      inputSchema: {
        event_id: z.string(),
        title: z.string().min(1).optional(),
        starts_at: z.string().optional(),
        ends_at: z.string().nullable().optional(),
        category: z.enum(EVENT_CATEGORIES).optional(),
        is_all_day: z.boolean().optional(),
        location: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        private: z.boolean().optional(),
      },
    },
    async ({ event_id, ...patch }) => {
      if (!groupId) return noGroupError();
      const event = await findVisibleEvent(admin, groupId, userId, event_id);
      if (!event) return toolError("Event not found");
      const updates: Record<string, unknown> = {};
      for (const key of [
        "title",
        "starts_at",
        "ends_at",
        "category",
        "is_all_day",
        "location",
        "notes",
        "private",
      ] as const) {
        if (patch[key] !== undefined) updates[key] = patch[key];
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await admin.from("events").update(updates).eq("id", event_id).eq("group_id", groupId);
        if (error) return toolError(error.message);
      }
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, id: event_id }) }] };
    }
  );

  register(
    "delete_event",
    {
      description: "Soft-delete a native Rooftap calendar event.",
      inputSchema: { event_id: z.string() },
    },
    async ({ event_id }) => {
      if (!groupId) return noGroupError();
      const event = await findVisibleEvent(admin, groupId, userId, event_id);
      if (!event) return toolError("Event not found");
      const { error } = await admin.from("events").update({ deleted: true }).eq("id", event_id).eq("group_id", groupId);
      if (error) return toolError(error.message);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, id: event_id }) }] };
    }
  );

  register(
    "get_grocery_items",
    {
      description:
        "Household grocery list items visible to the authenticated user. Pass status 'needed' for the shopping list; 'have' is the pantry stock, which is usually most of the list.",
      inputSchema: {
        status: z.enum(["needed", "have", "bought"]).optional(),
        detail: DETAIL,
      },
    },
    async ({ status, detail }) => {
      if (!groupId) return { content: [{ type: "text", text: JSON.stringify([]) }] };
      const { data } = await admin
        .from("grocery_items")
        .select("*")
        .eq("group_id", groupId)
        .eq("deleted", false);
      const visible = visibleGroceryItems((data ?? []) as GroceryItem[], userId).filter(
        (i) => !status || i.status === status
      );
      const items = detail === "full" ? visible : visible.map((i) => basic(i, GROCERY_BASIC));
      return { content: [{ type: "text", text: JSON.stringify(items) }] };
    }
  );

  register(
    "create_grocery_item",
    {
      description: "Add a new item to the household grocery list, attributed to the authenticated user.",
      inputSchema: {
        name: z.string().min(1),
        aisle: z.string().optional(),
        quantity: z.number().optional(),
        unit: z.string().optional(),
        status: z.enum(GROCERY_STATUSES).optional(),
        notes: z.string().optional(),
        price_cents: z.number().int().nonnegative().optional(),
        shelf_life_days: z.number().int().nonnegative().optional(),
        expiry_date: z.string().optional(),
        is_essential: z.boolean().optional(),
        private: z.boolean().optional(),
      },
    },
    async ({
      name,
      aisle,
      quantity,
      unit,
      status,
      notes,
      price_cents,
      shelf_life_days,
      expiry_date,
      is_essential,
      private: isPrivate,
    }) => {
      if (!groupId) return noGroupError();
      const row: Record<string, unknown> = {
        id: crypto.randomUUID(),
        group_id: groupId,
        name: name.trim(),
        aisle: aisle ?? "other",
        quantity: quantity ?? null,
        unit: unit ?? null,
        status: status ?? "needed",
        notes: notes ?? null,
        assigned_to: isPrivate ? userId : null,
        private: isPrivate ?? false,
        template_key: null,
        sort_order: 0,
        created_by: userId,
        updated_by: null,
        deleted: false,
        recurrence_days: null,
        status_changed_at: null,
        last_purchased_at: null,
        last_price: null,
        lowest_price: null,
        expiry_date: expiry_date ?? null,
        shelf_life_days: shelf_life_days ?? null,
        price_cents: price_cents ?? null,
        is_essential: is_essential ?? false,
        recipe_note: null,
        recipe_source_id: null,
        re_add_snoozed_until: null,
        re_add_dismissed_at: null,
      };
      const { error } = await admin.from("grocery_items").insert(row);
      if (error) return toolError(error.message);
      return { content: [{ type: "text", text: JSON.stringify(row) }] };
    }
  );

  register(
    "update_grocery_item",
    {
      description: "Update fields on an existing grocery list item (name, aisle, status, quantity, unit, notes, price, shelf life, expiry date, essential flag, private flag). Only the fields provided are changed; omit a field to leave it as-is.",
      inputSchema: {
        grocery_item_id: z.string(),
        name: z.string().min(1).optional(),
        aisle: z.string().optional(),
        quantity: z.number().nullable().optional(),
        unit: z.string().nullable().optional(),
        status: z.enum(GROCERY_STATUSES).optional(),
        notes: z.string().nullable().optional(),
        price_cents: z.number().int().nonnegative().nullable().optional(),
        shelf_life_days: z.number().int().nonnegative().nullable().optional(),
        expiry_date: z.string().nullable().optional(),
        is_essential: z.boolean().optional(),
        private: z.boolean().optional(),
      },
    },
    async ({ grocery_item_id, ...patch }) => {
      if (!groupId) return noGroupError();
      const item = await findVisibleGroceryItem(admin, groupId, userId, grocery_item_id);
      if (!item) return toolError("Grocery item not found");
      const updates: Record<string, unknown> = {};
      for (const key of [
        "name",
        "aisle",
        "quantity",
        "unit",
        "status",
        "notes",
        "price_cents",
        "shelf_life_days",
        "expiry_date",
        "is_essential",
        "private",
      ] as const) {
        if (patch[key] !== undefined) updates[key] = patch[key];
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await admin.from("grocery_items").update(updates).eq("id", grocery_item_id).eq("group_id", groupId);
        if (error) return toolError(error.message);
      }
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, id: grocery_item_id }) }] };
    }
  );

  register(
    "delete_grocery_item",
    {
      description: "Soft-delete a grocery list item.",
      inputSchema: { grocery_item_id: z.string() },
    },
    async ({ grocery_item_id }) => {
      if (!groupId) return noGroupError();
      const item = await findVisibleGroceryItem(admin, groupId, userId, grocery_item_id);
      if (!item) return toolError("Grocery item not found");
      const { error } = await admin
        .from("grocery_items")
        .update({ deleted: true })
        .eq("id", grocery_item_id)
        .eq("group_id", groupId);
      if (error) return toolError(error.message);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, id: grocery_item_id }) }] };
    }
  );

  // Dev-only: keeps MCP_TOOLS (packages/core/src/mcp-tools.ts) — the settings UI's
  // source of truth — from drifting away from the actual registerTool call
  // sites above. registeredNames is populated on every register() call
  // regardless of settings and modules, so this checks the call-site set, not what a
  // particular request's settings happened to allow.
  if (process.env.NODE_ENV !== "production") {
    const expected = new Set(MCP_TOOLS.map((t) => t.name));
    const missing = [...expected].filter((n) => !registeredNames.has(n));
    const extra = [...registeredNames].filter((n) => !expected.has(n));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `MCP_TOOLS drift: missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)} — keep packages/core/src/mcp-tools.ts in sync with buildServer()'s register() call sites.`
      );
    }
  }

  return server;
}

function rateLimited() {
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "60" },
  });
}

async function handleMcp(req: Request): Promise<Response> {
  const admin = createAdminClient();
  // A bot API key, or an access token from MCP sign-in.
  const authHeader = req.headers.get("authorization");
  let identity: { userId: string };
  if (isOAuthAccessToken(authHeader)) {
    const oauth = await resolveOAuthUser(admin, authHeader);
    if (!oauth) return unauthorized(req);
    if (!(await checkOAuthRateLimit(admin, oauth.tokenId))) return rateLimited();
    identity = oauth;
  } else {
    const pat = await resolvePatUser(admin, authHeader);
    if (!pat) return unauthorized(req);
    if (!(await checkPatRateLimit(admin, pat.patId))) return rateLimited();
    identity = pat;
  }

  const groupId = await resolveGroupId(admin, identity.userId);
  // MCP is a module (.docs/modules.md): while it's off the endpoint doesn't exist.
  const enabled = await getEnabledModules(admin, groupId);
  if (!enabled.has("mcp")) return moduleNotFound();
  const settings = await getMcpSettings(admin, identity.userId);
  const server = buildServer(admin, identity.userId, groupId, settings, enabled);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function POST(req: Request) {
  return handleMcp(req);
}

export async function GET(req: Request) {
  return handleMcp(req);
}
