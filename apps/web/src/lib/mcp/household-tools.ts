import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { visibleTasks, visibleEvents, visibleGroceryItems } from "@/lib/pat";
import {
  listCostItems,
  isTaskOwnerEnabled,
  applyTaskCompletion,
  billsDue,
  addDaysISO,
  toISODate,
  type ModuleId,
} from "@homeup/core";
import { memberNames } from "@/lib/member-names";
import {
  aiBlockedMessage,
  parseScoutBrief,
  scoutLatestRun,
  scoutRunStatus,
  scoutTitle,
  SCOUT_BRIEF_MAX,
  type Group,
} from "@homeup/core";
import {
  hasOfferSources,
  scoutBrain,
  startScoutRun,
} from "@/lib/shopper/scout";
import { readThread } from "@/lib/shopper/scout-thread";
import {
  withPriceChange,
  CATEGORY_META,
  type CostMonthCategory,
  type CostMonthLine,
  summariseAccounts,
  summariseSpending,
  bankRowJoint,
  costCategoryFromUp,
} from "@homeup/core";
import {
  bankSharing,
  visibleBankAccounts,
  visibleBankTransactions,
} from "@/lib/up-bank";
import { householdCostMonth } from "@/lib/cost-month-server";
import {
  changeBankTransaction,
  filePaymentInCategory,
  makeCostFromPayment,
  mergeCostLine,
  removeBankLinkRule,
  setBankLinkRule,
} from "@/lib/bank-actions";
import {
  buildChecklistItem,
  buildLoggedCost,
  buildNeededGroceryItem,
  checkItemPatch,
  completion,
  groceryStatusPatch,
  ingredientMatchKey,
  matchIngredientToGrocery,
  norm,
  recipeCuisines,
  recipeNoteFor,
  stepsFromInstructions,
  uncheckItemPatch,
  isKeptFrom,
} from "@homeup/core";
import type {
  HouseholdTask,
  GroupEvent,
  CostItem,
  CostCategory,
  CostCadence,
  EventCategory,
  GroceryItem,
  Checklist,
  ChecklistTaskItem,
  Recipe,
  RecipeIngredient,
  SetupItem,
  ShopperWant,
} from "@homeup/core";

// The household tool handlers behind both the public MCP server (/api/mcp)
// and the in-app assistant, so the two can never drift apart: same inputs,
// same household scoping, same private-item visibility. Each caller decides
// which tools to expose (modules, MCP settings, assistant trust); this module
// only says what the tools are and does the work.

/** The `{ content, isError }` shape MCP tools return. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export interface HouseholdTool {
  name: string;
  description: string;
  /** Zod raw shape, as MCP's registerTool takes it. Absent for tools with no input. */
  inputSchema?: z.ZodRawShape;
  // Each handler's argument type is tied to its own inputSchema, which a
  // shared list type can't re-derive, so the list holds them untyped; each
  // tool() call site below still type-checks its own handler literal.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<ToolResult>;
}

export interface HouseholdToolContext {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  groupId: string | null;
  /** The household's switched-on modules; task tools hide reminders whose owner module is off. */
  enabled: ReadonlySet<ModuleId>;
}

const COST_CATEGORIES = Object.keys(CATEGORY_META) as [
  CostCategory,
  ...CostCategory[],
];
const COST_CADENCES: [CostCadence, ...CostCadence[]] = [
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "yearly",
  "one_off",
];
/** A Costs category from its id (outing) or its label (Going out), any case. */
export function costCategoryFrom(value: string): CostCategory | null {
  const v = value.trim().toLowerCase();
  return (
    COST_CATEGORIES.find(
      (c) => c === v || CATEGORY_META[c].label.toLowerCase() === v,
    ) ?? null
  );
}
const CATEGORY_CHOICES = COST_CATEGORIES.filter((c) => c !== "income")
  .map((c) => `${CATEGORY_META[c].label} (${c})`)
  .join(", ");

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
const GROCERY_STATUSES: [GroceryItem["status"], ...GroceryItem["status"][]] = [
  "needed",
  "have",
  "bought",
];

function noGroupError() {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: "No household group" }),
      },
    ],
    isError: true,
  };
}

function toolError(message: string) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ error: message }) },
    ],
    isError: true,
  };
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
  enabled: ReadonlySet<ModuleId>,
): Promise<HouseholdTask | null> {
  const { data } = await admin
    .from("household_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("group_id", groupId)
    .eq("deleted", false);
  return (
    visibleTasks((data ?? []) as HouseholdTask[], userId).find((t) =>
      isTaskOwnerEnabled(t, enabled),
    ) ?? null
  );
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
  costItemId: string,
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
  eventId: string,
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
  groceryItemId: string,
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
    "basic (default) answers everyday questions; a field missing from a basic row is empty. full adds bookkeeping fields (reminders, recipe links, price history, timestamps).",
  );

function basic<T extends object>(
  row: T,
  keys: readonly (keyof T)[],
): Partial<T> {
  return Object.fromEntries(
    keys.filter((k) => row[k] != null).map((k) => [k, row[k]]),
  ) as Partial<T>;
}

const TASK_BASIC = [
  "id",
  "title",
  "due_date",
  "due_time",
  "done",
  "completed_at",
  "priority",
  "notes",
  "recurrence_days",
] as const;
const EVENT_BASIC = [
  "id",
  "title",
  "category",
  "starts_at",
  "ends_at",
  "is_all_day",
  "location",
  "notes",
] as const;
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

export function householdTools({
  admin,
  userId,
  groupId,
  enabled,
}: HouseholdToolContext): HouseholdTool[] {
  const tools: HouseholdTool[] = [];

  function tool<S extends z.ZodRawShape>(
    name: string,
    config: { description: string; inputSchema?: S },
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) {
    tools.push({
      name,
      description: config.description,
      inputSchema: config.inputSchema,
      handler: handler as HouseholdTool["handler"],
    });
  }

  tool(
    "get_budget_summary",
    {
      description:
        "Costs for one month, exactly as the Costs page shows it: spent (paid_cents), still to come (to_come_cents: recurring costs not paid yet, planned costs, and what is left of each category's usual shop spend), expected_cents (paid plus to come), the monthly goal, and income. categories lists each category with its lines: kind shop (a shop's bank payments summed), recurring (a recurring cost, paid or due), cost (added by hand), usual (usual spend left) or target (a plan the bank's payments replaced, not counted). source is up (a bank connector), csv or manual. cost_lines lists every cost line (recurring ones, ones added by hand, the bank's line for each shop, and archived ones) with its id for update_cost_item and update_bank_payment. To move a payment to another category, use update_bank_payment with category instead of looking for a line. Amounts in cents. Defaults to this month.",
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional()
          .describe("YYYY-MM; this month when left out."),
      },
    },
    async ({ month }) => {
      if (!groupId)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ paid_cents: 0, categories: [] }),
            },
          ],
        };
      const {
        month: m,
        items,
        goalCents,
      } = await householdCostMonth(admin, userId, groupId, month);
      const label = (c: string | null) =>
        c
          ? (CATEGORY_META[c as keyof typeof CATEGORY_META]?.label ?? c)
          : "No category yet";
      const LINES = 12;
      const lineOut = (l: CostMonthLine) => ({
        name: l.name,
        kind: l.kind,
        paid_cents: l.paidCents,
        ...(l.toComeCents ? { to_come_cents: l.toComeCents } : {}),
        ...(l.count ? { payments: l.count } : {}),
        ...(l.date ? { date: l.date } : {}),
        ...(l.source ? { source: l.source } : {}),
        ...(l.item ? { cost_item_id: l.item.id } : {}),
      });
      const categoryOut = (c: CostMonthCategory) => ({
        category: label(c.category),
        paid_cents: c.paidCents,
        to_come_cents: c.toComeCents,
        lines: c.lines.slice(0, LINES).map(lineOut),
        ...(c.lines.length > LINES
          ? { more_lines: c.lines.length - LINES }
          : {}),
      });
      // Every line, the bank's shop lines too, so any of them can be changed by id.
      const costLines = items.map((i) => ({
        id: i.id,
        name: i.name,
        category: label(i.category),
        amount_cents: i.amount,
        cadence: i.cadence,
        ...(i.start_date ? { date: i.start_date } : {}),
        ...(i.is_estimate ? { estimate: true } : {}),
        ...(i.archived ? { archived: true } : {}),
        ...(i.price_changes?.length ? { price_changes: i.price_changes } : {}),
        ...(i.bank_source ? { bank: i.bank_source } : {}),
      }));
      const body = {
        month: m.month,
        when: m.when,
        paid_cents: m.paidCents,
        to_come_cents: m.toComeCents,
        expected_cents: m.expectedCents,
        goal_cents: goalCents,
        income_cents: m.incomeCents,
        income_expected_cents: m.incomeExpectedCents,
        categories: m.categories.map(categoryOut),
        ...(m.income ? { income: categoryOut(m.income) } : {}),
        cost_lines: costLines,
      };
      return { content: [{ type: "text", text: JSON.stringify(body) }] };
    },
  );

  tool(
    "create_cost_item",
    {
      // Mirrors createOneOffCostItem's defaults (cadence: 'one_off', is_estimate: false) —
      // that helper can't be called directly here since it expects an
      // auth'd browser client (supabase.auth.getUser()), not the admin client.
      description:
        "Create a household cost line: a one-off purchase or bill by default, or a recurring cost with cadence. Category income records money in (pay), which never counts as a cost.",
      inputSchema: {
        name: z.string().min(1),
        amount: z.number().int().nonnegative().optional(),
        category: z.enum(COST_CATEGORIES).optional(),
        provider: z.string().optional(),
        start_date: z.string().optional(),
        notes: z.string().optional(),
        cadence: z
          .enum(COST_CADENCES)
          .optional()
          .describe("How often it repeats; one_off when left out."),
        is_estimate: z.boolean().optional(),
      },
    },
    async ({
      name,
      amount,
      category,
      provider,
      start_date,
      notes,
      cadence,
      is_estimate,
    }) => {
      if (!groupId) return noGroupError();
      const row: Record<string, unknown> = {
        id: crypto.randomUUID(),
        group_id: groupId,
        name: name.trim() || "Untitled",
        category: category ?? "other",
        amount: amount ?? 0,
        cadence: cadence ?? "one_off",
        is_estimate: is_estimate ?? false,
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
    },
  );

  tool(
    "update_cost_item",
    {
      description:
        "Update fields on an existing household cost line (name, amount, category, cadence, provider, dates, notes, estimate flag), archive it, or change a recurring line's price from a date on (price_from with price_cents). Setting a cadence other than one_off makes it recurring. Only the fields provided are changed; omit a field to leave it as-is.",
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
        archived: z
          .boolean()
          .optional()
          .describe(
            "true archives the line: it stays so bank payments still find it, but it leaves every total. false brings it back.",
          ),
        price_from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe(
            "With price_cents: the day a recurring line's new price starts, YYYY-MM-DD. Earlier dates keep the old price.",
          ),
        price_cents: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("With price_from: the new price in cents."),
      },
    },
    async ({ cost_item_id, archived, price_from, price_cents, ...patch }) => {
      if (!groupId) return noGroupError();
      const item = await findVisibleCostItem(admin, groupId, cost_item_id);
      if (!item) return toolError("Cost item not found");
      const updates: Record<string, unknown> = {};
      if (archived !== undefined) updates.archived = archived;
      if ((price_from === undefined) !== (price_cents === undefined))
        return toolError("Send price_from and price_cents together.");
      if (price_from !== undefined && price_cents !== undefined) {
        updates.price_changes = withPriceChange(
          item.price_changes ?? [],
          price_from,
          price_cents,
        );
      }
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
        const { error } = await admin
          .from("cost_items")
          .update(updates)
          .eq("id", cost_item_id)
          .eq("group_id", groupId);
        if (error) return toolError(error.message);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, id: cost_item_id }),
          },
        ],
      };
    },
  );

  tool(
    "delete_cost_item",
    {
      description: "Soft-delete a household cost line.",
      inputSchema: { cost_item_id: z.string() },
    },
    async ({ cost_item_id }) => {
      if (!groupId) return noGroupError();
      const item = await findVisibleCostItem(admin, groupId, cost_item_id);
      if (!item) return toolError("Cost item not found");
      const { error } = await admin
        .from("cost_items")
        .update({ deleted: true })
        .eq("id", cost_item_id)
        .eq("group_id", groupId);
      if (error) return toolError(error.message);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, id: cost_item_id }),
          },
        ],
      };
    },
  );

  tool(
    "get_tasks",
    {
      description:
        "Household to-dos visible to the authenticated user. Pass done false for what's still open, or done true for what got done: done ones come newest first with completed_at and who ticked it off (completed_by). recurrence_days says how often a to-do repeats; ticking off a repeating one makes the next. Each task says whether it's assigned to you.",
      inputSchema: {
        done: z.boolean().optional(),
        search: z
          .string()
          .optional()
          .describe(
            'Only to-dos whose title contains this text, any case (say "bins").',
          ),
        completed_since: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("YYYY-MM-DD: only to-dos ticked off on or after this day."),
        detail: DETAIL,
      },
    },
    async ({ done, search, completed_since, detail }) => {
      if (!groupId)
        return { content: [{ type: "text", text: JSON.stringify([]) }] };
      const { data } = await admin
        .from("household_tasks")
        .select("*")
        .eq("group_id", groupId)
        .eq("deleted", false);
      const needle = search?.trim().toLowerCase();
      const tasks = visibleTasks((data ?? []) as HouseholdTask[], userId)
        .filter((t) => isTaskOwnerEnabled(t, enabled))
        .filter((t) => done === undefined || t.done === done)
        .filter((t) => !needle || t.title.toLowerCase().includes(needle))
        .filter(
          (t) =>
            !completed_since ||
            (!!t.completed_at &&
              t.completed_at.slice(0, 10) >= completed_since),
        )
        .sort(
          (a, b) =>
            Number(a.done) - Number(b.done) ||
            (b.completed_at ?? "").localeCompare(a.completed_at ?? ""),
        );
      if (detail === "full")
        return { content: [{ type: "text", text: JSON.stringify(tasks) }] };
      const names = tasks.some((t) => t.completed_by)
        ? await memberNames(admin, groupId).catch(
            () => new Map<string, string>(),
          )
        : null;
      const shaped = tasks.map((t) => ({
        ...basic(t, TASK_BASIC),
        assigned_to_me: t.assigned_to === userId,
        ...(t.completed_by
          ? {
              completed_by:
                t.completed_by === userId
                  ? "you"
                  : (names?.get(t.completed_by) ?? "someone"),
            }
          : {}),
      }));
      return { content: [{ type: "text", text: JSON.stringify(shaped) }] };
    },
  );

  tool(
    "create_task",
    {
      description:
        "Create a new household to-do, assigned to the authenticated user. Set repeat_every_days for a chore that repeats (bins every Tuesday: due_date the next Tuesday, repeat_every_days 7).",
      inputSchema: {
        title: z.string().min(1),
        due_date: z.string().optional(),
        due_time: z.string().optional(),
        notes: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        private: z.boolean().optional(),
        repeat_every_days: z
          .number()
          .int()
          .min(1)
          .max(366)
          .nullable()
          .optional()
          .describe(
            "Repeat this often in days: 7 weekly, 14 fortnightly, 30 monthly. Needs a due date for the first one. null stops repeating.",
          ),
      },
    },
    async ({
      title,
      due_date,
      due_time,
      notes,
      priority,
      private: isPrivate,
      repeat_every_days,
    }) => {
      if (!groupId) return noGroupError();
      const id = crypto.randomUUID();
      const row: Record<string, unknown> = {
        id,
        group_id: groupId,
        title,
        due_date: due_date ?? null,
        due_time: due_time ?? null,
        offset_days: null,
        recurrence_days: repeat_every_days ?? null,
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ...row, priority: priority ?? "medium" }),
          },
        ],
      };
    },
  );

  tool(
    "update_task",
    {
      description:
        "Update fields on an existing household to-do (title, due date/time, notes, priority, private flag, how often it repeats). Only the fields provided are changed; omit a field to leave it as-is.",
      inputSchema: {
        task_id: z.string(),
        title: z.string().min(1).optional(),
        due_date: z.string().nullable().optional(),
        due_time: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        private: z.boolean().optional(),
        repeat_every_days: z
          .number()
          .int()
          .min(1)
          .max(366)
          .nullable()
          .optional()
          .describe(
            "Repeat this often in days: 7 weekly, 14 fortnightly, 30 monthly. Needs a due date for the first one. null stops repeating.",
          ),
      },
    },
    async ({ task_id, repeat_every_days, ...patch }) => {
      if (!groupId) return noGroupError();
      const task = await findVisibleTask(
        admin,
        groupId,
        userId,
        task_id,
        enabled,
      );
      if (!task) return toolError("Task not found");
      const updates: Record<string, unknown> = {};
      for (const key of [
        "title",
        "due_date",
        "due_time",
        "notes",
        "priority",
        "private",
      ] as const) {
        if (patch[key] !== undefined) updates[key] = patch[key];
      }
      if (repeat_every_days !== undefined)
        updates.recurrence_days = repeat_every_days;
      if (Object.keys(updates).length > 0) {
        const { error } = await admin
          .from("household_tasks")
          .update(updates)
          .eq("id", task_id)
          .eq("group_id", groupId);
        if (error) return toolError(error.message);
      }
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, id: task_id }) },
        ],
      };
    },
  );

  tool(
    "complete_task",
    {
      description:
        "Mark a household to-do done or not done. Ticking off a repeating to-do makes its next one, as the app does.",
      inputSchema: { task_id: z.string(), done: z.boolean() },
    },
    async ({ task_id, done }) => {
      if (!groupId) return noGroupError();
      const task = await findVisibleTask(
        admin,
        groupId,
        userId,
        task_id,
        enabled,
      );
      if (!task) return toolError("Task not found");
      // Already in that state: change nothing, so a repeat never makes a second next one.
      if (task.done === done)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, id: task_id, done }),
            },
          ],
        };
      const { update, createNextOccurrence } = applyTaskCompletion(task, done, {
        nextId: crypto.randomUUID(),
      });
      // The service role has no signed-in person for the trigger to read, so say who.
      const { error } = await admin
        .from("household_tasks")
        .update({ ...update, completed_by: done ? userId : null })
        .eq("id", task_id)
        .eq("group_id", groupId);
      if (error) return toolError(error.message);
      let next: { id: string; due_date: string | null } | undefined;
      if (createNextOccurrence) {
        // The database stamps the times.
        const row: Partial<HouseholdTask> = { ...createNextOccurrence };
        delete row.created_at;
        delete row.updated_at;
        const { error: nextError } = await admin
          .from("household_tasks")
          .insert(row);
        if (nextError) return toolError(nextError.message);
        next = {
          id: createNextOccurrence.id,
          due_date: createNextOccurrence.due_date,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              id: task_id,
              done,
              ...(next ? { next } : {}),
            }),
          },
        ],
      };
    },
  );

  tool(
    "delete_task",
    {
      description: "Soft-delete a household to-do.",
      inputSchema: { task_id: z.string() },
    },
    async ({ task_id }) => {
      if (!groupId) return noGroupError();
      const task = await findVisibleTask(
        admin,
        groupId,
        userId,
        task_id,
        enabled,
      );
      if (!task) return toolError("Task not found");
      const { error } = await admin
        .from("household_tasks")
        .update({ deleted: true })
        .eq("id", task_id)
        .eq("group_id", groupId);
      if (error) return toolError(error.message);
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, id: task_id }) },
        ],
      };
    },
  );

  tool(
    "get_upcoming_calendar_events",
    {
      description:
        "Upcoming native Rooftap calendar events visible to the authenticated user (excludes the Google Calendar overlay).",
      inputSchema: {
        days: z.number().int().positive().max(90).optional(),
        detail: DETAIL,
      },
    },
    async ({ days, detail }) => {
      if (!groupId)
        return { content: [{ type: "text", text: JSON.stringify([]) }] };
      const now = new Date();
      const until = new Date(
        now.getTime() + (days ?? 30) * 24 * 60 * 60 * 1000,
      );
      const { data } = await admin
        .from("events")
        .select("*")
        .eq("group_id", groupId)
        .eq("deleted", false)
        .gte("starts_at", now.toISOString())
        .lte("starts_at", until.toISOString());
      const events = visibleEvents((data ?? []) as GroupEvent[], userId);
      const shaped =
        detail === "full" ? events : events.map((e) => basic(e, EVENT_BASIC));
      return { content: [{ type: "text", text: JSON.stringify(shaped) }] };
    },
  );

  tool(
    "get_agenda",
    {
      description:
        "What's due across the household in the next days, in one answer: open to-dos due (and overdue ones), calendar events, and bills from Costs with their usual amount. Use it for \"what's due this week\". Parts whose module is off are left out. Amounts in cents.",
      inputSchema: {
        days: z
          .number()
          .int()
          .positive()
          .max(31)
          .optional()
          .describe("How many days ahead, today included; 7 when left out."),
      },
    },
    async ({ days }) => {
      const span = days ?? 7;
      if (!groupId)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ tasks: [], events: [], bills: [] }),
            },
          ],
        };
      const costsOn = enabled.has("costs");
      const cost = costsOn
        ? await householdCostMonth(admin, userId, groupId)
        : null;
      // The person's today: Costs already works it out from their time zone.
      const today = cost
        ? toISODate(cost.today)
        : new Date().toISOString().slice(0, 10);
      const last = addDaysISO(today, span - 1);
      const out: Record<string, unknown> = { from: today, to: last };
      if (enabled.has("household")) {
        const { data } = await admin
          .from("household_tasks")
          .select("*")
          .eq("group_id", groupId)
          .eq("deleted", false)
          .eq("done", false);
        const open = visibleTasks((data ?? []) as HouseholdTask[], userId)
          .filter((t) => isTaskOwnerEnabled(t, enabled))
          .filter((t) => t.due_date && t.due_date <= last)
          .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
        const row = (t: HouseholdTask) => ({
          ...basic(t, TASK_BASIC),
          assigned_to_me: t.assigned_to === userId,
        });
        out.overdue_tasks = open.filter((t) => t.due_date! < today).map(row);
        out.tasks = open.filter((t) => t.due_date! >= today).map(row);
      }
      if (enabled.has("calendar")) {
        const { data } = await admin
          .from("events")
          .select("*")
          .eq("group_id", groupId)
          .eq("deleted", false)
          .gte("starts_at", new Date(Date.now() - 12 * 3600_000).toISOString())
          .lte(
            "starts_at",
            new Date(Date.now() + (span + 1) * 86_400_000).toISOString(),
          );
        out.events = visibleEvents((data ?? []) as GroupEvent[], userId)
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
          .map((e) => basic(e, EVENT_BASIC));
      }
      if (cost) {
        out.bills = billsDue(cost.items, cost.links, cost.today, span - 1).map(
          (b) => ({
            name: b.item.name,
            due: toISODate(b.due),
            amount_cents: b.amountCents,
            ...(b.item.is_estimate ? { estimate: true } : {}),
            category: CATEGORY_META[b.item.category]?.label ?? b.item.category,
            cost_item_id: b.item.id,
          }),
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    },
  );

  tool(
    "create_event",
    {
      description:
        "Create a new native Rooftap calendar event, attributed to the authenticated user. Does not touch the Google Calendar overlay or appointments.",
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
    async ({
      title,
      starts_at,
      ends_at,
      category,
      is_all_day,
      location,
      notes,
      private: isPrivate,
    }) => {
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
    },
  );

  tool(
    "update_event",
    {
      description:
        "Update fields on an existing native Rooftap calendar event (title, times, category, all-day flag, location, notes, private flag). Only the fields provided are changed; omit a field to leave it as-is.",
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
        const { error } = await admin
          .from("events")
          .update(updates)
          .eq("id", event_id)
          .eq("group_id", groupId);
        if (error) return toolError(error.message);
      }
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, id: event_id }) },
        ],
      };
    },
  );

  tool(
    "delete_event",
    {
      description: "Soft-delete a native Rooftap calendar event.",
      inputSchema: { event_id: z.string() },
    },
    async ({ event_id }) => {
      if (!groupId) return noGroupError();
      const event = await findVisibleEvent(admin, groupId, userId, event_id);
      if (!event) return toolError("Event not found");
      const { error } = await admin
        .from("events")
        .update({ deleted: true })
        .eq("id", event_id)
        .eq("group_id", groupId);
      if (error) return toolError(error.message);
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, id: event_id }) },
        ],
      };
    },
  );

  tool(
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
      if (!groupId)
        return { content: [{ type: "text", text: JSON.stringify([]) }] };
      const { data } = await admin
        .from("grocery_items")
        .select("*")
        .eq("group_id", groupId)
        .eq("deleted", false);
      const visible = visibleGroceryItems(
        (data ?? []) as GroceryItem[],
        userId,
      ).filter((i) => !status || i.status === status);
      const items =
        detail === "full"
          ? visible
          : visible.map((i) => basic(i, GROCERY_BASIC));
      return { content: [{ type: "text", text: JSON.stringify(items) }] };
    },
  );

  tool(
    "create_grocery_item",
    {
      description:
        "Add a new item to the household grocery list, attributed to the authenticated user.",
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
    },
  );

  tool(
    "update_grocery_item",
    {
      description:
        "Update fields on an existing grocery list item (name, aisle, status, quantity, unit, notes, price, shelf life, expiry date, essential flag, private flag). Only the fields provided are changed; omit a field to leave it as-is.",
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
      const item = await findVisibleGroceryItem(
        admin,
        groupId,
        userId,
        grocery_item_id,
      );
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
        const { error } = await admin
          .from("grocery_items")
          .update(updates)
          .eq("id", grocery_item_id)
          .eq("group_id", groupId);
        if (error) return toolError(error.message);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, id: grocery_item_id }),
          },
        ],
      };
    },
  );

  tool(
    "delete_grocery_item",
    {
      description: "Soft-delete a grocery list item.",
      inputSchema: { grocery_item_id: z.string() },
    },
    async ({ grocery_item_id }) => {
      if (!groupId) return noGroupError();
      const item = await findVisibleGroceryItem(
        admin,
        groupId,
        userId,
        grocery_item_id,
      );
      if (!item) return toolError("Grocery item not found");
      const { error } = await admin
        .from("grocery_items")
        .update({ deleted: true })
        .eq("id", grocery_item_id)
        .eq("group_id", groupId);
      if (error) return toolError(error.message);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, id: grocery_item_id }),
          },
        ],
      };
    },
  );

  // ── Recipes, checklists, Home Setup and Shopper ─────────────────────────────
  // So the assistant can answer "what can I cook", "what's left on the packing
  // list" or "what are we still watching", and do the few changes people ask
  // for by voice (tick an item, add to a list, put a recipe's ingredients on
  // the grocery list). Same scoping rule as above: group_id + deleted=false
  // on every read, since the admin client bypasses RLS.

  tool(
    "get_recipes",
    {
      description:
        "The household's saved recipes. With no arguments, a short list (title, cuisines, method, times, ingredient names). Pass query to filter by a word in the title, a cuisine or an ingredient. Pass recipe_id for one recipe in full: ingredients with quantities, and the steps.",
      inputSchema: {
        query: z.string().optional(),
        recipe_id: z.string().optional(),
      },
    },
    async ({ query, recipe_id }) => {
      if (!groupId)
        return { content: [{ type: "text", text: JSON.stringify([]) }] };
      let recipeQuery = admin
        .from("recipes")
        .select("*")
        .eq("group_id", groupId)
        .eq("deleted", false)
        .eq("draft", false);
      if (recipe_id) recipeQuery = recipeQuery.eq("id", recipe_id);
      const { data: recipeRows, error } = await recipeQuery;
      if (error) return toolError(error.message);
      const recipes = (recipeRows ?? []) as Recipe[];
      if (recipe_id && recipes.length === 0)
        return toolError("Recipe not found");
      const ids = recipes.map((r) => r.id);
      const { data: ingredientRows } = ids.length
        ? await admin
            .from("recipe_ingredients")
            .select("*")
            .eq("group_id", groupId)
            .eq("deleted", false)
            .in("recipe_id", ids)
        : { data: [] };
      const byRecipe = new Map<string, RecipeIngredient[]>();
      for (const ing of ((ingredientRows ?? []) as RecipeIngredient[]).sort(
        (a, b) => a.position - b.position,
      )) {
        byRecipe.set(ing.recipe_id, [
          ...(byRecipe.get(ing.recipe_id) ?? []),
          ing,
        ]);
      }
      if (recipe_id) {
        const recipe = recipes[0];
        const full = {
          ...basic(recipe, [
            "id",
            "title",
            "method",
            "servings",
            "prep_minutes",
            "cook_minutes",
            "source",
          ] as const),
          cuisines: recipeCuisines(recipe),
          ingredients: (byRecipe.get(recipe.id) ?? []).map((i) =>
            basic(i, ["name", "quantity", "unit"] as const),
          ),
          steps: stepsFromInstructions(recipe.instructions),
        };
        return { content: [{ type: "text", text: JSON.stringify(full) }] };
      }
      const q = norm(query);
      const rows = recipes
        .map((r) => ({
          ...basic(r, [
            "id",
            "title",
            "method",
            "servings",
            "prep_minutes",
            "cook_minutes",
          ] as const),
          cuisines: recipeCuisines(r),
          ingredients: (byRecipe.get(r.id) ?? []).map((i) => i.name),
        }))
        .filter(
          (r) =>
            !q ||
            [r.title ?? "", ...r.cuisines, ...r.ingredients].some((s) =>
              norm(s).includes(q),
            ),
        )
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    },
  );

  tool(
    "add_recipe_to_groceries",
    {
      description:
        "Put a recipe's ingredients on the grocery list. Ingredients already on the list as needed, or in stock (have or bought), are left alone unless include_stocked is true; the result says which were added and which were skipped.",
      inputSchema: {
        recipe_id: z.string(),
        include_stocked: z.boolean().optional(),
      },
    },
    async ({ recipe_id, include_stocked }) => {
      if (!groupId) return noGroupError();
      if (!enabled.has("groceries"))
        return toolError("The Groceries module is off for this household");
      const { data: recipeRows } = await admin
        .from("recipes")
        .select("*")
        .eq("id", recipe_id)
        .eq("group_id", groupId)
        .eq("deleted", false);
      const recipe = ((recipeRows ?? []) as Recipe[])[0];
      if (!recipe) return toolError("Recipe not found");
      const [{ data: ingredientRows }, { data: groceryRows }] =
        await Promise.all([
          admin
            .from("recipe_ingredients")
            .select("*")
            .eq("recipe_id", recipe_id)
            .eq("group_id", groupId)
            .eq("deleted", false),
          admin
            .from("grocery_items")
            .select("*")
            .eq("group_id", groupId)
            .eq("deleted", false),
        ]);
      const ingredients = ((ingredientRows ?? []) as RecipeIngredient[]).sort(
        (a, b) => a.position - b.position,
      );
      const groceries = visibleGroceryItems(
        (groceryRows ?? []) as GroceryItem[],
        userId,
      );
      const added: string[] = [];
      const skipped: { name: string; reason: string }[] = [];
      for (const ing of ingredients) {
        const key = ingredientMatchKey(ing);
        const match = matchIngredientToGrocery(key, groceries);
        if (match?.status === "needed") {
          skipped.push({ name: key, reason: "already on the list" });
          continue;
        }
        if (match && !include_stocked) {
          skipped.push({ name: key, reason: "in stock" });
          continue;
        }
        const note = recipeNoteFor(ing, recipe.title);
        const { error } = match
          ? await admin
              .from("grocery_items")
              .update({
                ...groceryStatusPatch("needed"),
                recipe_note: note,
                recipe_source_id: recipe.id,
                updated_by: userId,
              })
              .eq("id", match.id)
              .eq("group_id", groupId)
          : await admin.from("grocery_items").insert(
              buildNeededGroceryItem({
                groupId,
                name: key,
                recipeNote: note,
                recipeSourceId: recipe.id,
                createdBy: userId,
                quantity: ing.quantity,
                unit: ing.unit,
              }),
            );
        if (error) return toolError(error.message);
        added.push(key);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ recipe: recipe.title, added, skipped }),
          },
        ],
      };
    },
  );

  tool(
    "get_checklists",
    {
      description:
        "The household's checklists (packing, cleaning, shopping runs and so on) with their items. Open lists only unless include_completed is true; pass checklist_id for one list.",
      inputSchema: {
        checklist_id: z.string().optional(),
        include_completed: z.boolean().optional(),
      },
    },
    async ({ checklist_id, include_completed }) => {
      if (!groupId)
        return { content: [{ type: "text", text: JSON.stringify([]) }] };
      let listQuery = admin
        .from("checklists")
        .select("*")
        .eq("group_id", groupId)
        .eq("deleted", false);
      if (checklist_id) listQuery = listQuery.eq("id", checklist_id);
      const { data: listRows, error } = await listQuery;
      if (error) return toolError(error.message);
      const lists = ((listRows ?? []) as Checklist[]).filter(
        (l) => checklist_id || include_completed || !l.completed_at,
      );
      if (checklist_id && lists.length === 0)
        return toolError("Checklist not found");
      const ids = lists.map((l) => l.id);
      const { data: itemRows } = ids.length
        ? await admin
            .from("checklist_task_items")
            .select("*")
            .eq("group_id", groupId)
            .eq("deleted", false)
            .in("checklist_id", ids)
        : { data: [] };
      const byList = new Map<string, ChecklistTaskItem[]>();
      for (const item of ((itemRows ?? []) as ChecklistTaskItem[]).sort(
        (a, b) => a.order - b.order,
      )) {
        byList.set(item.checklist_id, [
          ...(byList.get(item.checklist_id) ?? []),
          item,
        ]);
      }
      const rows = lists.map((l) => ({
        ...basic(l, [
          "id",
          "title",
          "type",
          "scheduled_date",
          "completed_at",
        ] as const),
        items: (byList.get(l.id) ?? []).map((i) =>
          basic(i, ["id", "label", "is_done", "cost_cents"] as const),
        ),
      }));
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    },
  );

  tool(
    "add_checklist_item",
    {
      description: "Add an item to the end of a checklist.",
      inputSchema: {
        checklist_id: z.string(),
        label: z.string().min(1),
        cost_cents: z.number().int().nonnegative().optional(),
      },
    },
    async ({ checklist_id, label, cost_cents }) => {
      if (!groupId) return noGroupError();
      const { data: listRows } = await admin
        .from("checklists")
        .select("*")
        .eq("id", checklist_id)
        .eq("group_id", groupId)
        .eq("deleted", false);
      const list = ((listRows ?? []) as Checklist[])[0];
      if (!list) return toolError("Checklist not found");
      const { data: itemRows } = await admin
        .from("checklist_task_items")
        .select("*")
        .eq("checklist_id", list.id)
        .eq("group_id", groupId)
        .eq("deleted", false);
      const items = (itemRows ?? []) as ChecklistTaskItem[];
      const row = buildChecklistItem({
        checklistId: list.id,
        groupId,
        label,
        order: items.reduce((max, i) => Math.max(max, i.order), -1) + 1,
        costCents: cost_cents ?? null,
      });
      const { error } = await admin.from("checklist_task_items").insert(row);
      if (error) return toolError(error.message);
      // A finished list that gains an item is open again, as in the app.
      if (list.completed_at && list.type !== "repeating") {
        await admin
          .from("checklists")
          .update({ completed_at: null })
          .eq("id", list.id)
          .eq("group_id", groupId);
        if (list.linked_task_id)
          await admin
            .from("household_tasks")
            .update({ done: false, completed_at: null })
            .eq("id", list.linked_task_id)
            .eq("group_id", groupId);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              id: row.id,
              checklist: list.title,
            }),
          },
        ],
      };
    },
  );

  tool(
    "check_checklist_item",
    {
      description:
        "Tick (or with done false, untick) a checklist item. Ticking the last open item completes the list and its linked to-do, and a priced item on a shopping list logs its cost, the same as ticking it in the app.",
      inputSchema: {
        item_id: z.string(),
        done: z.boolean().optional(),
      },
    },
    async ({ item_id, done = true }) => {
      if (!groupId) return noGroupError();
      const { data: itemRows } = await admin
        .from("checklist_task_items")
        .select("*")
        .eq("id", item_id)
        .eq("group_id", groupId)
        .eq("deleted", false);
      const item = ((itemRows ?? []) as ChecklistTaskItem[])[0];
      if (!item) return toolError("Checklist item not found");
      const { data: listRows } = await admin
        .from("checklists")
        .select("*")
        .eq("id", item.checklist_id)
        .eq("group_id", groupId)
        .eq("deleted", false);
      const list = ((listRows ?? []) as Checklist[])[0];
      if (!list) return toolError("Checklist not found");
      if (item.is_done === done)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, id: item.id, unchanged: true }),
            },
          ],
        };

      const patch: Record<string, unknown> = done
        ? checkItemPatch(userId)
        : uncheckItemPatch();
      if (
        done &&
        enabled.has("costs") &&
        list.type === "shopping" &&
        list.log_costs &&
        (item.cost_cents ?? 0) > 0 &&
        !item.linked_cost_item_id
      ) {
        const cost = buildLoggedCost({
          item,
          checklist: list,
          createdBy: userId,
        });
        const { error } = await admin.from("cost_items").insert(cost);
        if (error) return toolError(error.message);
        patch.linked_cost_item_id = cost.id;
      } else if (!done && item.linked_cost_item_id) {
        await admin
          .from("cost_items")
          .update({ deleted: true })
          .eq("id", item.linked_cost_item_id)
          .eq("group_id", groupId);
        patch.linked_cost_item_id = null;
      }
      const { error } = await admin
        .from("checklist_task_items")
        .update(patch)
        .eq("id", item.id)
        .eq("group_id", groupId);
      if (error) return toolError(error.message);

      // Completion sync, as useChecklistToggle does in the apps.
      const { data: siblingRows } = await admin
        .from("checklist_task_items")
        .select("*")
        .eq("checklist_id", list.id)
        .eq("group_id", groupId)
        .eq("deleted", false);
      const projected = ((siblingRows ?? []) as ChecklistTaskItem[]).map((i) =>
        i.id === item.id ? { ...i, is_done: done } : i,
      );
      const { complete } = completion(projected);
      const now = new Date().toISOString();
      if (list.linked_task_id) {
        await admin
          .from("household_tasks")
          .update(
            complete
              ? { done: true, completed_at: now }
              : { done: false, completed_at: null },
          )
          .eq("id", list.linked_task_id)
          .eq("group_id", groupId);
      }
      if (list.type !== "repeating" && complete !== !!list.completed_at) {
        await admin
          .from("checklists")
          .update({ completed_at: complete ? now : null })
          .eq("id", list.id)
          .eq("group_id", groupId);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              id: item.id,
              checklist_complete: complete,
            }),
          },
        ],
      };
    },
  );

  tool(
    "get_setup_items",
    {
      description:
        "Home Setup: the things the household is buying or installing for the home, by room, with priority and prices (amounts in cents). Pass status 'needed' for what is still to get.",
      inputSchema: {
        status: z.enum(["needed", "installed"]).optional(),
        room: z.string().optional(),
      },
    },
    async ({ status, room }) => {
      if (!groupId)
        return { content: [{ type: "text", text: JSON.stringify([]) }] };
      const { data, error } = await admin
        .from("setup_items")
        .select("*")
        .eq("group_id", groupId)
        .eq("deleted", false);
      if (error) return toolError(error.message);
      const rows = ((data ?? []) as SetupItem[])
        .filter((i) => !(i.private && i.assigned_to !== userId))
        .filter(
          (i) =>
            (!status || i.status === status) &&
            (!room || norm(i.room) === norm(room)),
        )
        .map((i) =>
          basic(i, [
            "id",
            "name",
            "room",
            "status",
            "priority",
            "est_price",
            "actual_price",
            "where_to_buy",
            "url",
            "notes",
          ] as const),
        );
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    },
  );

  tool(
    "get_watchlist",
    {
      description:
        "Shopper: things the household wants to buy, with the target and budget and the best price found so far (amounts in cents). Watching and idea items unless status says otherwise.",
      inputSchema: {
        status: z.enum(["watching", "idea", "bought"]).optional(),
      },
    },
    async ({ status }) => {
      if (!groupId)
        return { content: [{ type: "text", text: JSON.stringify([]) }] };
      const { data, error } = await admin
        .from("shopper_wants")
        .select("*")
        .eq("group_id", groupId)
        .eq("deleted", false);
      if (error) return toolError(error.message);
      const rows = ((data ?? []) as ShopperWant[])
        // The service role skips RLS: leave out watches kept from this person (Occasions).
        .filter((w) => !isKeptFrom(w, userId))
        .filter((w) => (status ? w.status === status : w.status !== "bought"))
        .map((w) =>
          basic(w, [
            "id",
            "title",
            "status",
            "target_cents",
            "budget_cents",
            "best_cents",
            "best_store",
            "need_by",
            "last_checked_at",
            "notes",
          ] as const),
        );
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    },
  );

  // Scout from a chat: the assistant (or any MCP client) can start a Scout
  // search and read its picks. The run is the same as one started in Shopper,
  // with the same key, plan and allowance checks, and its page is where the
  // person asks follow-ups or changes the search.
  tool(
    "start_scout",
    {
      description:
        "Shopper: start a Scout search, an AI researcher that checks the household's price sources and comes back with up to three picks in about a minute. Use it when someone asks you to find, research or shop for something to buy. Budget in whole currency units. Tell them it's researching and link the run (link field) so they can open it; they get a notification when it's done. Read the picks later with get_scout_run.",
      inputSchema: {
        text: z
          .string()
          .min(3)
          .max(SCOUT_BRIEF_MAX)
          .describe("What they want, in their own words, with any must-haves."),
        budget_max: z.number().positive().optional(),
        budget_min: z.number().positive().optional(),
        need_by: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        where: z.array(z.enum(["nearby", "online", "secondhand"])).optional(),
      },
    },
    async ({ text, budget_max, budget_min, need_by, where }) => {
      if (!groupId) return toolError("No household.");
      const parsed = parseScoutBrief({
        text,
        budget_max_cents: budget_max ? Math.round(budget_max * 100) : null,
        budget_min_cents: budget_min ? Math.round(budget_min * 100) : null,
        need_by,
        where,
      });
      if ("error" in parsed) return toolError(parsed.error);
      const { data: group } = await admin
        .from("groups")
        .select("*")
        .eq("id", groupId)
        .single();
      if (!group) return toolError("No household.");
      const decided = await scoutBrain(admin, groupId);
      if ("blocked" in decided)
        return toolError(aiBlockedMessage(decided.blocked));
      if (!(await hasOfferSources(group as Group)))
        return toolError(
          "No price sources are set up on this server, so Scout has nothing to search.",
        );
      const run = await startScoutRun(
        admin,
        group as Group,
        userId,
        parsed.brief,
        decided.brain,
      );
      if (!run) return toolError("Could not start Scout.");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: run.id,
              status: "running",
              title: scoutTitle(run.brief),
              link: `/shopper/scout/${run.id}`,
            }),
          },
        ],
      };
    },
  );

  tool(
    "get_scout_run",
    {
      description:
        "Shopper: a Scout search and its newest picks (prices in cents), with why each fits. Without an id, the household's latest search. status running means it is still researching.",
      inputSchema: { id: z.string().uuid().optional() },
    },
    async ({ id }) => {
      if (!groupId) return toolError("No household.");
      let runId = id ?? null;
      if (!runId) {
        const { data } = await admin
          .from("shopper_searches")
          .select("id")
          .eq("group_id", groupId)
          .eq("deleted", false)
          .order("created_at", { ascending: false })
          .limit(1);
        runId = (data?.[0] as { id: string } | undefined)?.id ?? null;
      }
      if (!runId) return toolError("No Scout searches yet.");
      const thread = await readThread(admin, runId);
      const latest = thread ? scoutLatestRun(thread) : null;
      if (!thread || !latest || latest.group_id !== groupId)
        return toolError("Scout search not found.");
      const root = thread.runs.find((r) => !r.thread_id) ?? latest;
      const picks = thread.picks
        .filter((p) => p.search_id === latest.id)
        .map((p) =>
          basic(p, [
            "rank",
            "title",
            "price_cents",
            "currency",
            "store",
            "url",
            "in_stock",
            "stretch",
            "label",
            "why",
          ] as const),
        );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: latest.id,
              status: scoutRunStatus(latest),
              brief: latest.brief,
              error: latest.error,
              picks,
              link: `/shopper/scout/${root.id}`,
            }),
          },
        ],
      };
    },
  );

  // Up Bank connector: the caller's Up transactions, and those of household
  // members who share theirs. Read only; amounts in cents, money out negative.
  tool(
    "get_bank_spending",
    {
      description:
        "Up Bank: account balances and spending from the bank data this person may see (their own, plus household members who share theirs). Current balances per account, totals and the matching transactions, newest first. spent_cents, by_category (Up's categories) and by_cost_category (the Costs categories) count every payment in the range, however many there are; transactions lists only the newest ones (limit), so add up the totals, never the list. accounts narrows it to joint or personal accounts; unfiled lists only payments no cost line holds. Each transaction has an id for update_bank_payment and make_cost_from_payment, its Costs category (cost_category), and cost_item_id and cost_line when it is filed under a cost line. Amounts in cents; money out is negative. Transfers between their own accounts and payments hidden from spending are left out. Defaults to the last 30 days.",
      inputSchema: {
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("First day, YYYY-MM-DD."),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Last day, YYYY-MM-DD, included."),
        search: z
          .string()
          .max(100)
          .optional()
          .describe("Words in the description, e.g. a store name."),
        category: z
          .string()
          .max(60)
          .optional()
          .describe("Up category id, e.g. takeaway, groceries, fuel."),
        accounts: z
          .enum(["all", "joint", "personal"])
          .optional()
          .describe(
            "Joint accounts only, personal accounts only, or all (the default).",
          ),
        unfiled: z
          .boolean()
          .optional()
          .describe(
            "Only payments not filed under any cost line, to reconcile them.",
          ),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ from, to, search, category, accounts, unfiled, limit }) => {
      if (!groupId) return noGroupError();
      const end = to
        ? new Date(`${to}T00:00:00Z`).getTime() + 86_400_000
        : Date.now();
      const start = from
        ? new Date(`${from}T00:00:00Z`).getTime()
        : end - 30 * 86_400_000;
      if (!(end > start) || end - start > 400 * 86_400_000)
        return toolError("Pick a range of up to about a year.");
      let rows = await visibleBankTransactions(admin, {
        userId,
        groupId,
        from: new Date(start).toISOString(),
        to: new Date(end).toISOString(),
        limit: 5000,
      });
      const words = search?.trim().toLowerCase();
      if (words)
        rows = rows.filter((r) =>
          `${r.description} ${r.message ?? ""} ${(r.tags ?? []).join(" ")}`
            .toLowerCase()
            .includes(words),
        );
      if (category)
        rows = rows.filter(
          (r) => r.category === category || r.parent_category === category,
        );
      if (accounts && accounts !== "all") {
        const sharing = await bankSharing(admin, userId, groupId);
        rows = rows.filter(
          (r) => bankRowJoint(r, sharing) === (accounts === "joint"),
        );
      }
      if (unfiled) rows = rows.filter((r) => !r.cost_item_id);
      const summary = summariseSpending(
        rows,
        from ?? new Date(start).toISOString().slice(0, 10),
        { recent: 0 },
      );
      // A joint payment arrives once per partner who shares it; keep the
      // caller's own copy, the one they can change.
      const byPayment = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        if (r.is_transfer || r.hidden) continue;
        const had = byPayment.get(r.external_id);
        if (!had || (had.user_id !== userId && r.user_id === userId))
          byPayment.set(r.external_id, r);
      }
      const listed = Array.from(byPayment.values())
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .slice(0, limit ?? 30);
      // Totals in the Costs categories: the cost line's when it is filed, else from Up's.
      const lines = new Map(
        (await listCostItems(admin, groupId)).map((i) => [i.id, i]),
      );
      const lineCategory = new Map(
        [...lines].map(([id, i]) => [id, i.category]),
      );
      const costLabel = (t: (typeof rows)[number]) => {
        const c =
          (t.cost_item_id && lineCategory.get(t.cost_item_id)) ||
          costCategoryFromUp(t.category ?? t.parent_category);
        return CATEGORY_META[c as keyof typeof CATEGORY_META]?.label ?? c;
      };
      const byCost = new Map<string, number>();
      let payments = 0;
      for (const t of byPayment.values()) {
        if (t.amount_cents >= 0) continue;
        payments++;
        const label = costLabel(t);
        byCost.set(label, (byCost.get(label) ?? 0) + -t.amount_cents);
      }
      // Balances arrive with servers that have bank_accounts; older ones have none to show.
      const balances = summariseAccounts(
        await visibleBankAccounts(admin, userId, groupId).catch(() => []),
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              accounts: balances.accounts.map((a) => ({
                name: a.name,
                type: a.type === "SAVER" ? "saver" : "everyday",
                joint: a.joint,
                balance_cents: a.balanceCents,
              })),
              from: new Date(start).toISOString().slice(0, 10),
              to: new Date(end - 1).toISOString().slice(0, 10),
              spent_cents: summary.spentCents,
              received_cents: summary.receivedCents,
              payments_out: payments,
              by_category: summary.categories.map((c) => ({
                category: c.id,
                label: c.label,
                cents: c.cents,
              })),
              by_cost_category: [...byCost]
                .sort((a, b) => b[1] - a[1])
                .map(([label, cents]) => ({ label, cents })),
              listed: `${listed.length} newest of ${byPayment.size}`,
              transactions: listed.map((t) => ({
                id: t.id,
                date: t.occurred_at.slice(0, 10),
                description: t.description,
                amount_cents: t.amount_cents,
                category: t.category ?? t.parent_category,
                tags: t.tags?.length ? t.tags : undefined,
                note: t.note || undefined,
                cost_item_id: t.cost_item_id ?? null,
                ...(t.cost_item_id && lines.get(t.cost_item_id)
                  ? { cost_line: lines.get(t.cost_item_id)!.name }
                  : {}),
                cost_category: costLabel(t),
                pending: t.status === "HELD",
                mine: t.user_id === userId,
              })),
            }),
          },
        ],
      };
    },
  );

  // Bank actions: the same rules as the Money view. Only the person who
  // connected an account changes its payments, and nothing goes to the bank.
  const bankResult = (
    result: { ok: unknown } | { error: string },
    body: (ok: never) => unknown,
  ) =>
    "error" in result
      ? toolError(result.error)
      : {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(body(result.ok as never)),
            },
          ],
        };

  tool(
    "update_bank_payment",
    {
      description:
        "Up Bank: change one of this person's own bank payments (ids from get_bank_spending). To put it in another Costs category (\"file it under Going out\"), pass category: no line id is needed. A payment on its shop's own line moves the whole shop to that category; any other payment gets a line of its own there. Or file it under a cost line by hand (cost_item_id, from get_budget_summary's cost_lines), give it back to the link rules (cost_item_id: null), hide it from spending or count it again (hidden), or set a note (note; null clears it). To file every payment from this payee under a line, also call set_bank_link_rule. Payments a household member shares can't be changed.",
      inputSchema: {
        payment_id: z.string(),
        category: z
          .string()
          .max(40)
          .optional()
          .describe(`A Costs category, by name or id: ${CATEGORY_CHOICES}.`),
        cost_item_id: z.string().nullable().optional(),
        hidden: z.boolean().optional(),
        note: z.string().max(500).nullable().optional(),
      },
    },
    async ({ payment_id, category, cost_item_id, hidden, note }) => {
      if (!groupId) return noGroupError();
      let filed: {
        cost_item_id: string;
        line: string;
        category: string;
        moved_whole_shop: boolean;
      } | null = null;
      if (category !== undefined) {
        const c = costCategoryFrom(category);
        if (!c || c === "income")
          return toolError(
            `No Costs category called ${category}. Pick one of: ${CATEGORY_CHOICES}.`,
          );
        const done = await filePaymentInCategory(
          { admin, userId, groupId },
          payment_id,
          c,
        );
        if ("error" in done) return toolError(done.error);
        filed = {
          cost_item_id: done.ok.costItemId,
          line: done.ok.name,
          category: CATEGORY_META[c].label,
          moved_whole_shop: done.ok.movedLine,
        };
        if (
          cost_item_id === undefined &&
          hidden === undefined &&
          note === undefined
        ) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: true, id: payment_id, ...filed }),
              },
            ],
          };
        }
      }
      const result = await changeBankTransaction(
        { admin, userId, groupId },
        payment_id,
        { costItemId: cost_item_id, hidden, note },
      );
      return bankResult(
        result,
        (t: {
          id: string;
          description: string;
          cost_item_id: string | null;
          hidden: boolean;
          note: string | null;
        }) => ({
          ok: true,
          id: t.id,
          description: t.description,
          cost_item_id: t.cost_item_id,
          hidden: t.hidden,
          note: t.note,
          ...(filed ? { filed } : {}),
        }),
      );
    },
  );

  tool(
    "make_cost_from_payment",
    {
      description:
        "Up Bank: create a household cost line from one of this person's own payments (id from get_bank_spending) and file the payment under it. Rooftap takes the amount, a category from the bank's (or category, when given), and how often from the payee's past payments. Pass name to call it something else (e.g. Rent). link_future_payments files the payee's other payments under the new line too. Use update_bank_payment instead when a matching cost line already exists.",
      inputSchema: {
        payment_id: z.string(),
        name: z.string().min(1).max(200).optional(),
        category: z
          .string()
          .max(40)
          .optional()
          .describe(`A Costs category, by name or id: ${CATEGORY_CHOICES}.`),
        link_future_payments: z.boolean().optional(),
      },
    },
    async ({ payment_id, name, category, link_future_payments }) => {
      if (!groupId) return noGroupError();
      const c = category === undefined ? undefined : costCategoryFrom(category);
      if (c === null || c === "income")
        return toolError(
          `No Costs category called ${category}. Pick one of: ${CATEGORY_CHOICES}.`,
        );
      const result = await makeCostFromPayment(
        { admin, userId, groupId },
        payment_id,
        { name, linkPayee: link_future_payments === true, category: c },
      );
      return bankResult(result, (ok: { costItemId: string; name: string }) => ({
        ok: true,
        cost_item_id: ok.costItemId,
        name: ok.name,
      }));
    },
  );

  tool(
    "set_bank_link_rule",
    {
      description:
        "Up Bank: file bank payments under a cost line automatically. match is words from the payee's description (e.g. the landlord's name) or an Up tag written as #tag. Past and future payments that match move to the line. keep_amount keeps the line's amount in step with the latest payment. match: null removes the cost line's rule. One rule per cost line; a new one replaces it.",
      inputSchema: {
        cost_item_id: z.string(),
        match: z.string().max(200).nullable(),
        keep_amount: z.boolean().optional(),
      },
    },
    async ({ cost_item_id, match, keep_amount }) => {
      if (!groupId) return noGroupError();
      const caller = { admin, userId, groupId };
      if (match === null) {
        const removed = await removeBankLinkRule(caller, cost_item_id);
        return bankResult(removed, () => ({
          ok: true,
          cost_item_id,
          match: null,
        }));
      }
      const result = await setBankLinkRule(
        caller,
        cost_item_id,
        match,
        keep_amount === true,
      );
      return bankResult(result, (ok: { match: string }) => ({
        ok: true,
        cost_item_id,
        match: ok.match,
      }));
    },
  );

  tool(
    "merge_cost_lines",
    {
      description:
        "Up Bank: fold one cost line into another, for a line the bank made that duplicates one the household made by hand (say a water bill). The first line's payees join the second line's rule, its payments move over, and the first line is deleted. Ids from get_budget_summary.",
      inputSchema: {
        cost_item_id: z.string(),
        into_cost_item_id: z.string(),
      },
    },
    async ({ cost_item_id, into_cost_item_id }) => {
      if (!groupId) return noGroupError();
      const result = await mergeCostLine(
        { admin, userId, groupId },
        cost_item_id,
        into_cost_item_id,
      );
      return bankResult(result, () => ({
        ok: true,
        merged: cost_item_id,
        into: into_cost_item_id,
      }));
    },
  );

  return tools;
}
