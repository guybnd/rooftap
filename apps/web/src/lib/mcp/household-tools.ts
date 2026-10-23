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
import { agendaExtras, moduleTools } from "./module-tools";
// new-module:tool-import (scripts/new-module.mjs adds above this line)
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
  allCookTimers,
  assistantTimer,
  buildCookSession,
  clampStep,
  cookTimers,
  recipeSteps,
  startTimer,
  stepIngredients,
  timerRemainingMs,
  timerState,
  type CookSession,
} from "@homeup/core";
import { loadMealWeek, personTimeZone, todayIn } from "@/lib/meal-plan-server";
import {
  buildMealPlanEntry,
  planMealNight,
  isNightPlanned,
  mealDishesByDate,
  mealNightHint,
  mealRole,
  mealNightLabel,
  mealWeekRangeLabel,
  mealWeekStart,
  recipeMinutes,
  weekShopping,
  type MealPlanEntry,
  aliasMap,
  isStaple,
  stapleKeys,
  type IngredientAlias,
  type RecipeStaple,
} from "@homeup/core";
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
  buildGiftIdea,
  buildOccasion,
  buildWishlistItem,
  daysToOccasion,
  defaultHiddenFrom,
  ideasForOccasion,
  nextOccasionDay,
  sortOccasions,
  suggestedOccasionTitle,
  takenBy,
  wishlistOccasion,
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
  Occasion,
  GiftIdea,
  WishlistItem,
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
  /** The device asking (cook mode sends it), so a timer the tools start rings there. */
  deviceId?: string | null;
  /**
   * The turn is in the household's shared chat, read by every member: tools
   * leave out anything kept from anyone (gift surprises), not just from this person.
   */
  shared?: boolean;
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
  deviceId,
  shared = false,
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
        "Costs for one month, exactly as the Costs page shows it: spent (paid_cents), still to come (to_come_cents: recurring costs not paid yet, planned costs, and what is left of each category's usual shop spend), expected_cents (paid plus to come), the monthly goal, and income. categories lists each category with its lines: kind shop (a shop's bank payments summed), recurring (a recurring cost, paid or due), cost (added by hand), usual (usual spend left) or target (a plan the bank's payments replaced, not counted). source is up (a bank connector), csv or manual. cost_lines lists every cost line (recurring ones, ones added by hand, the bank's line for each shop, and archived ones) with its id for update_cost_item and update_bank_payment. To move a payment to another category, use update_bank_payment with category instead of looking for a line. Amounts in cents. Defaults to this month. When you talk about a month's spending, say how it stands against goal_cents (spent so far and expected by month end), when there is a goal.",
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
        "Create a household cost line: a one-off purchase or bill by default, or a recurring cost with cadence. Category income records money in (pay), which never counts as a cost. For a recurring cost, set cadence and start_date (the first payment, YYYY-MM-DD) and name both in your one-line summary, so the person can check them in one go.",
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
        "What's due across the household in the next days, in one answer: open to-dos due (and overdue ones), calendar events, bills from Costs with their usual amount, bin nights (night_of is the evening they go out), Home care jobs due, the planned dinners, and birthdays and other occasions. Use it for \"what's due this week\" and \"what's on today\". Parts whose module is off are left out. Amounts in cents.",
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
      Object.assign(out, await agendaExtras({ admin, userId, groupId, enabled, shared }, today, last));
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

  // Recipes scan match: the household's staples (never on the list) and the
  // names it taught the match step, so the tools agree with the app.
  const loadRecipeMatch = async () => {
    const [{ data: stapleRows }, { data: aliasRows }] = await Promise.all([
      admin.from("recipe_staples").select("*").eq("group_id", groupId).eq("deleted", false),
      admin.from("ingredient_aliases").select("*").eq("group_id", groupId).eq("deleted", false),
    ]);
    return {
      staples: stapleKeys((stapleRows ?? []) as RecipeStaple[]),
      aliases: aliasMap((aliasRows ?? []) as IngredientAlias[]),
    };
  };

  tool(
    "add_recipe_to_groceries",
    {
      description:
        "Put a recipe's ingredients on the grocery list. Ingredients already on the list as needed, or in stock (have or bought), are left alone unless include_stocked is true. Household staples (salt, oil and the like) never go on the list. The result says which were added and which were skipped.",
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
      const { staples, aliases } = await loadRecipeMatch();
      const added: string[] = [];
      const skipped: { name: string; reason: string }[] = [];
      for (const ing of ingredients) {
        const own = ingredientMatchKey(ing);
        if (isStaple(own, staples) || isStaple(ing.name, staples)) {
          skipped.push({ name: own, reason: "staple" });
          continue;
        }
        // A name the household taught ("arborio rice" is our "Risotto rice").
        const key = aliases.get(norm(own)) ?? own;
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

  // ── Cooking (Recipes v2 R7) ─────────────────────────────────────────────────
  // So "how long is left on the rice" and "start a 10 minute timer" work from
  // cook mode, or from any chat. A cook is the person's own (cook_sessions,
  // user_id); the admin client bypasses RLS, so every read filters on it.

  async function liveRecipe(recipeId: string) {
    const { data } = await admin.from("recipes").select("*").eq("id", recipeId).eq("group_id", groupId!).eq("deleted", false);
    return ((data ?? []) as Recipe[])[0] ?? null;
  }

  async function myCooks() {
    const { data, error } = await admin.from("cook_sessions").select("*").eq("group_id", groupId!).eq("user_id", userId).eq("deleted", false);
    return { cooks: (data ?? []) as CookSession[], error };
  }

  tool(
    "get_recipe_steps",
    {
      description:
        "One recipe's method as numbered steps (1-based), each with its timers (label, minutes) and the ingredients it uses, plus the step the person is on if they are cooking it. Use before start_timer, or to answer \"what's next\".",
      inputSchema: { recipe_id: z.string() },
    },
    async ({ recipe_id }) => {
      if (!groupId) return noGroupError();
      const recipe = await liveRecipe(recipe_id);
      if (!recipe) return toolError("Recipe not found");
      const [{ data: ingredientRows }, { cooks }] = await Promise.all([
        admin.from("recipe_ingredients").select("*").eq("group_id", groupId).eq("recipe_id", recipe.id).eq("deleted", false),
        myCooks(),
      ]);
      const ingredients = (ingredientRows ?? []) as RecipeIngredient[];
      const steps = recipeSteps(recipe);
      const cook = cooks.find((c) => c.recipe_id === recipe.id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              recipe_id: recipe.id,
              title: recipe.title,
              servings: recipe.servings,
              ...(cook ? { cooking_step: clampStep(cook.step, steps.length) + 1 } : {}),
              steps: steps.map((st, i) => ({
                step: i + 1,
                text: st.text,
                timers: st.timers.map((t) => ({ label: t.label, minutes: Math.round((t.seconds / 60) * 10) / 10 })),
                ingredients: stepIngredients(st, ingredients).map((ing) => basic(ing, ["name", "quantity", "unit"] as const)),
              })),
            }),
          },
        ],
      };
    },
  );

  tool(
    "get_running_cooks",
    {
      description:
        "The recipes the person is cooking right now: each with the step they are on (1-based) and its timers (label, step, state running/paused/done, seconds_left).",
    },
    async () => {
      if (!groupId) return noGroupError();
      const { cooks, error } = await myCooks();
      if (error) return toolError(error.message);
      const ids = [...new Set(cooks.map((c) => c.recipe_id))];
      const { data: recipeRows } = ids.length
        ? await admin.from("recipes").select("*").eq("group_id", groupId).in("id", ids)
        : { data: [] };
      const recipes = new Map(((recipeRows ?? []) as Recipe[]).map((r) => [r.id, r]));
      const now = Date.now();
      const out = cooks
        .filter((c) => recipes.has(c.recipe_id))
        .map((c) => {
          const recipe = recipes.get(c.recipe_id)!;
          const steps = recipeSteps(recipe);
          return {
            cook_id: c.id,
            recipe_id: recipe.id,
            title: recipe.title,
            step: clampStep(c.step, steps.length) + 1,
            steps: steps.length,
            timers: cookTimers(c).map((t) => ({
              label: t.label,
              step: t.step + 1,
              state: timerState(t, now),
              seconds_left: Math.round(timerRemainingMs(t, now) / 1000),
            })),
          };
        });
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    },
  );

  tool(
    "start_timer",
    {
      description:
        "Start a cooking timer on a recipe the person is cooking (it starts cooking the recipe if needed). Pass step (1-based, defaults to the step they are on), and label and/or minutes: a step's own timer is used when the label or minutes match one, else a new timer is added. It rings on the device they asked from, or the one they last started a timer on (rings false: it only shows in the app).",
      inputSchema: {
        recipe_id: z.string(),
        step: z.number().int().min(1).optional(),
        label: z.string().max(40).optional(),
        minutes: z.number().positive().max(24 * 60).optional(),
      },
    },
    async ({ recipe_id, step, label, minutes }) => {
      if (!groupId) return noGroupError();
      if (!enabled.has("recipes")) return toolError("The Recipes module is off for this household");
      const recipe = await liveRecipe(recipe_id);
      if (!recipe) return toolError("Recipe not found");
      const { cooks, error } = await myCooks();
      if (error) return toolError(error.message);
      const steps = recipeSteps(recipe);
      const existing = cooks.find((c) => c.recipe_id === recipe.id) ?? null;
      const stepIndex = clampStep(step != null ? step - 1 : existing?.step ?? 0, steps.length);
      const timers = existing ? allCookTimers(existing) : [];
      const pick = assistantTimer(steps[stepIndex], stepIndex, timers, { label, minutes });
      if (!pick) return toolError("Say how many minutes: this step has no timer of its own");
      // Rings on the asking device, else on the device the person last started a timer from.
      const startedAt = (t: { endsAt: string | null; seconds: number }) => (t.endsAt ? Date.parse(t.endsAt) - t.seconds * 1000 : 0);
      const lastDevice = cooks
        .flatMap((c) => cookTimers(c))
        .filter((t) => t.deviceId)
        .sort((a, b) => startedAt(b) - startedAt(a))[0]?.deviceId;
      const ringOn = deviceId ?? lastDevice ?? null;
      const next = startTimer(timers, pick, ringOn, Date.now());
      const { error: writeError } = existing
        ? await admin.from("cook_sessions").update({ timers: next }).eq("id", existing.id).eq("group_id", groupId).eq("user_id", userId)
        : await admin.from("cook_sessions").insert({ ...buildCookSession({ groupId, userId, recipeId: recipe.id }), step: stepIndex, timers: next });
      if (writeError) return toolError(writeError.message);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, recipe: recipe.title, step: pick.step + 1, label: pick.label, minutes: Math.round((pick.seconds / 60) * 10) / 10, rings: Boolean(ringOn) }),
          },
        ],
      };
    },
  );

  // ── Meal plan (Recipes > This week) ─────────────────────────────────────────
  // So "what's for dinner" and "put the curry on Thursday with rice" work. A
  // night holds several dishes, one row each (a main plus sides and a
  // dessert), or one row with a label (mealDishesByDate). set_meal edits the
  // night and tidies away rows the night doesn't show.

  tool(
    "get_meal_plan",
    {
      description:
        "The household's dinner plan for one week (Monday to Sunday). Each night has dishes (recipe_id, title, role main, side or dessert, minutes) or a label (Out, Leftovers, free text), who cooks (cook_user_id), and calendar hints for busy evenings. today is the person's date. With Groceries on, each night has to_buy (its ingredients not on the list or in stock), and missing lists ingredients of the planned recipes from today on that are not on the shopping list or in stock; add them with add_recipe_to_groceries. Defaults to this week; pass any date in another week to read that one.",
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Any YYYY-MM-DD in the week to read; this week when left out."),
      },
    },
    async ({ date }) => {
      if (!groupId) return noGroupError();
      if (!enabled.has("recipes")) return toolError("The Recipes module is off for this household");
      const timeZone = await personTimeZone(admin, userId);
      const today = todayIn(timeZone);
      const week = await loadMealWeek(admin, { userId, groupId, weekStart: mealWeekStart(date ?? today), timeZone, enabled });
      const dishesByDate = mealDishesByDate(week.entries);
      const staples = enabled.has("groceries") ? (await loadRecipeMatch()).staples : undefined;
      const shoppingFor = (entries: MealPlanEntry[], fromDate: string) =>
        weekShopping({
          entries,
          fromDate,
          recipesById: week.recipesById,
          ingredientsByRecipe: week.ingredientsByRecipe,
          groceryItems: week.groceryItems,
          staples,
        });
      const nights = week.weekDates.map((d) => {
        const rows = dishesByDate.get(d) ?? [];
        const entry = rows[0];
        const dishes = rows.flatMap((e) => {
          const recipe = e.recipe_id ? week.recipesById.get(e.recipe_id) : undefined;
          return recipe ? [{ recipe_id: recipe.id, title: recipe.title, role: mealRole(e), minutes: recipeMinutes(recipe) }] : [];
        });
        const planned = dishes.length > 0 || isNightPlanned(entry, week.recipesById);
        const hint = enabled.has("calendar") ? mealNightHint(d, week.agenda, planned) : null;
        return {
          date: d,
          weekday: mealNightLabel(d).weekday,
          ...(dishes.length ? { dishes } : {}),
          ...(!dishes.length && entry?.label ? { label: entry.label } : {}),
          ...(entry?.cook_user_id ? { cook_user_id: entry.cook_user_id } : {}),
          ...(entry?.note ? { note: entry.note } : {}),
          ...(enabled.has("groceries") && dishes.length && d >= today ? { to_buy: shoppingFor(rows, d).missing.length } : {}),
          ...(hint ? { hint } : {}),
        };
      });
      const shopping = enabled.has("groceries") ? shoppingFor([...dishesByDate.values()].flat(), today) : null;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              today,
              week: mealWeekRangeLabel(week.weekDates[0]),
              nights,
              ...(shopping
                ? { missing: shopping.missing.map((m) => ({ name: m.key, recipe_id: m.recipe.id })), already_on_list: shopping.onList }
                : {}),
            }),
          },
        ],
      };
    }
  );

  tool(
    "set_meal",
    {
      description:
        "Plan one night's dinner. A night holds several dishes (a main plus sides and a dessert) or one label. recipe_id (from get_recipes) sets the main dish and keeps the sides; with add true it adds the recipe as another dish instead (role side by default, or main when the night has none). role (main, side, dessert) sets that recipe's role on the night. remove_recipe_id takes one dish off. label (Out, Leftovers, or a few words) replaces the whole night. cook_user_id says who cooks the night (a member's user id; null clears it). clear true empties the night. Fields left out keep their value.",
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        recipe_id: z.string().optional(),
        add: z.boolean().optional().describe("Add recipe_id as another dish instead of replacing the main."),
        role: z.enum(["main", "side", "dessert"]).optional().describe("The role of recipe_id on the night."),
        remove_recipe_id: z.string().optional().describe("Take this recipe's dish off the night."),
        label: z.string().max(60).optional(),
        cook_user_id: z.string().nullable().optional(),
        note: z.string().max(200).nullable().optional(),
        clear: z.boolean().optional(),
      },
    },
    async ({ date, recipe_id, add, role, remove_recipe_id, label, cook_user_id, note, clear }) => {
      if (!groupId) return noGroupError();
      if (!enabled.has("recipes")) return toolError("The Recipes module is off for this household");
      if (recipe_id) {
        const { data: recipeRows } = await admin.from("recipes").select("id").eq("id", recipe_id).eq("group_id", groupId).eq("deleted", false);
        if (!(recipeRows ?? []).length) return toolError("Recipe not found");
      }
      if (cook_user_id) {
        const { data: member } = await admin.from("group_members").select("user_id").eq("group_id", groupId).eq("user_id", cook_user_id).maybeSingle();
        if (!member) return toolError("That person is not in this household");
      }
      const { data: rows, error } = await admin
        .from("meal_plan_entries")
        .select("*")
        .eq("group_id", groupId)
        .eq("date", date)
        .eq("slot", "dinner")
        .eq("deleted", false);
      if (error) return toolError(error.message);
      const existing = (rows ?? []) as MealPlanEntry[];
      const plan = planMealNight(existing, date, {
        recipeId: recipe_id ?? null,
        add: !!add,
        role: role ?? null,
        removeRecipeId: remove_recipe_id ?? null,
        label: label ?? null,
        clear: !!clear,
      });
      if ("error" in plan) return toolError(plan.error);
      const dishes = plan.inserts.length + plan.keep.length;
      const shared: Partial<MealPlanEntry> = {
        ...(cook_user_id !== undefined ? { cook_user_id } : {}),
      };
      for (const [id, patch] of plan.updates) {
        const { error: writeError } = await admin
          .from("meal_plan_entries")
          .update({ ...patch, ...shared, ...(note !== undefined && id === plan.first ? { note } : {}) })
          .eq("id", id)
          .eq("group_id", groupId);
        if (writeError) return toolError(writeError.message);
      }
      if (Object.keys(shared).length) {
        const untouched = plan.keep.filter((id) => !plan.updates.has(id));
        if (untouched.length) await admin.from("meal_plan_entries").update(shared).eq("group_id", groupId).in("id", untouched);
      }
      if (note !== undefined && plan.first && !plan.updates.has(plan.first)) {
        await admin.from("meal_plan_entries").update({ note }).eq("id", plan.first).eq("group_id", groupId);
      }
      const cook = cook_user_id !== undefined ? cook_user_id : existing.find((e) => plan.keep.includes(e.id))?.cook_user_id ?? null;
      if (plan.inserts.length) {
        const { error: insertError } = await admin.from("meal_plan_entries").insert(
          plan.inserts.map((ins, i) =>
            buildMealPlanEntry({
              groupId,
              date,
              recipeId: ins.recipeId,
              label: ins.label,
              role: ins.role,
              position: ins.position,
              cookUserId: cook,
              note: i === 0 && !plan.first ? note ?? null : null,
              createdBy: userId,
            }),
          ),
        );
        if (insertError) return toolError(insertError.message);
      }
      if (plan.remove.length) {
        const { error: delError } = await admin.from("meal_plan_entries").update({ deleted: true }).eq("group_id", groupId).in("id", plan.remove);
        if (delError) return toolError(delError.message);
      }
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, date, ...(clear ? { cleared: true } : { dishes }) }) }] };
    }
  );

  // ── Occasions (gifts) ───────────────────────────────────────────────────────
  // So "add these to Tegan's birthday list" works. The service role skips RLS,
  // so these tools hide by hand what the database hides from this person:
  // occasions and gift ideas kept from them. In the household's shared chat
  // (shared) everyone reads the reply, so nothing kept from anyone is shown,
  // and gift ideas can't be added there at all.

  const keptHere = (row: { hidden_from?: string[] | null }) =>
    (row.hidden_from ?? []).includes(userId) || (shared && (row.hidden_from ?? []).length > 0);
  const priceCents = (price: number | undefined) => (price == null ? null : Math.round(price * 100));
  const giftItem = z.object({
    title: z.string().min(1).max(200),
    price: z.number().nonnegative().optional().describe("Whole currency units."),
    url: z.string().max(2000).optional(),
    notes: z.string().max(1000).optional(),
  });

  async function occasionsContext(gid: string) {
    const [timeZone, members, occasionRows] = await Promise.all([
      personTimeZone(admin, userId),
      admin.from("group_members").select("user_id").eq("group_id", gid),
      admin.from("occasions").select("*").eq("group_id", gid).eq("deleted", false),
    ]);
    if (occasionRows.error) throw new Error(occasionRows.error.message);
    return {
      today: todayIn(timeZone),
      memberIds: ((members.data ?? []) as { user_id: string }[]).map((m) => m.user_id),
      occasions: ((occasionRows.data ?? []) as Occasion[]).filter((o) => !keptHere(o)),
    };
  }

  tool(
    "get_occasions",
    {
      description:
        "Occasions: the household's birthdays, anniversaries and other days, soonest first, with next_date, days_to, who it is for (person_user_id for a member, person for a name), the gift budget and the gift ideas so far (status idea, watching, bought or booked; prices in cents; kept_from names the members an idea is kept from). wishlists lists each member's own wishlist; taken says someone already plans to give that thing. Never tell a member about ideas kept from them.",
    },
    async () => {
      if (!groupId) return noGroupError();
      const { today, occasions } = await occasionsContext(groupId);
      const [names, ideaRows, wishRows] = await Promise.all([
        memberNames(admin, groupId),
        admin.from("gift_ideas").select("*").eq("group_id", groupId).eq("deleted", false),
        admin.from("wishlist_items").select("*").eq("group_id", groupId).eq("deleted", false),
      ]);
      if (ideaRows.error) return toolError(ideaRows.error.message);
      if (wishRows.error) return toolError(wishRows.error.message);
      const ideas = ((ideaRows.data ?? []) as GiftIdea[]).filter((i) => !keptHere(i));
      const nameOf = (id: string) => names.get(id) ?? "Someone";
      const ideaOut = (i: GiftIdea) => ({
        ...basic(i, ["id", "title", "status", "price_cents", "url", "notes"] as const),
        ...(i.for_user_id ? { for: nameOf(i.for_user_id) } : i.for_name ? { for: i.for_name } : {}),
        ...(i.hidden_from.length ? { kept_from: i.hidden_from.map(nameOf) } : {}),
      });
      const loose = ideas.filter((i) => !i.occasion_id || !occasions.some((o) => o.id === i.occasion_id));
      const wishes = (wishRows.data ?? []) as WishlistItem[];
      const owners = [...new Set(wishes.map((w) => w.user_id))];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              today,
              occasions: sortOccasions(occasions, today).map((o) => ({
                id: o.id,
                title: o.title,
                kind: o.kind,
                date: o.date,
                repeats: o.repeats,
                next_date: nextOccasionDay(o, today),
                days_to: daysToOccasion(o, today),
                ...(o.person_id ? { person_user_id: o.person_id, person: nameOf(o.person_id) } : o.person_name ? { person: o.person_name } : {}),
                ...(o.budget_cents != null ? { budget_cents: o.budget_cents } : {}),
                ...(o.notes ? { notes: o.notes } : {}),
                ...(o.hidden_from.length ? { kept_from: o.hidden_from.map(nameOf) } : {}),
                ideas: ideasForOccasion(ideas, o.id).map(ideaOut),
              })),
              ...(loose.length ? { other_ideas: loose.map(ideaOut) } : {}),
              wishlists: owners.map((owner) => ({
                user_id: owner,
                name: nameOf(owner),
                items: wishes
                  .filter((w) => w.user_id === owner)
                  .map((w) => ({
                    ...basic(w, ["id", "title", "price_cents", "url", "notes"] as const),
                    // Never to the owner, and never where the owner may read it.
                    ...(!shared && owner !== userId && takenBy(w, ideas) ? { taken: true } : {}),
                  })),
              })),
            }),
          },
        ],
      };
    },
  );

  tool(
    "add_occasion",
    {
      description:
        "Occasions: add a birthday, anniversary or other day. person_user_id for a household member, or person_name for someone outside it (Mum). date is YYYY-MM-DD; for a birthday or anniversary with an unknown year use any year, it repeats every year. budget in whole currency units. keep_from_user_ids keeps it from those members, for a surprise party; not in the household's shared chat. Ask for the date rather than guessing it.",
      inputSchema: {
        kind: z.enum(["birthday", "anniversary", "holiday", "other"]),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        title: z.string().max(120).optional().describe("Defaults to \"Tegan's birthday\" style."),
        person_user_id: z.string().optional(),
        person_name: z.string().max(80).optional(),
        repeats: z.boolean().optional().describe("Every year; true by default."),
        budget: z.number().nonnegative().optional(),
        notes: z.string().max(1000).optional(),
        keep_from_user_ids: z.array(z.string()).max(20).optional(),
      },
    },
    async ({ kind, date, title, person_user_id, person_name, repeats, budget, notes, keep_from_user_ids }) => {
      if (!groupId) return noGroupError();
      if (shared && keep_from_user_ids?.length) {
        return toolError("Surprises can't be planned in the household chat, where everyone reads it. Ask in a private chat.");
      }
      const { memberIds, occasions } = await occasionsContext(groupId);
      if (person_user_id && !memberIds.includes(person_user_id)) return toolError("That person is not in this household");
      const keepFrom = [...new Set(keep_from_user_ids ?? [])].filter((id) => id !== userId);
      if (keepFrom.some((id) => !memberIds.includes(id))) return toolError("Someone in keep_from_user_ids is not in this household");
      const names = await memberNames(admin, groupId);
      const who = person_user_id ? names.get(person_user_id) ?? null : person_name?.trim() || null;
      if (kind === "birthday" && person_user_id) {
        const existing = occasions.find((o) => o.kind === "birthday" && o.person_id === person_user_id);
        if (existing) return toolError(`${who ?? "They"} already have a birthday in Occasions (id ${existing.id}, ${existing.date})`);
      }
      const row = buildOccasion({
        id: crypto.randomUUID(),
        groupId,
        title: title?.trim() || suggestedOccasionTitle(kind, who) || kind[0].toUpperCase() + kind.slice(1),
        kind,
        date,
        repeats,
        personId: person_user_id ?? null,
        personName: person_name ?? null,
        budgetCents: priceCents(budget),
        notes: notes ?? null,
        hiddenFrom: keepFrom,
        createdBy: userId,
      });
      const { error } = await admin.from("occasions").insert(row);
      if (error) return toolError(error.message);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              id: row.id,
              title: row.title,
              date: row.date,
              ...(keepFrom.length ? { kept_from: keepFrom.map((id) => names.get(id) ?? "Someone") } : {}),
            }),
          },
        ],
      };
    },
  );

  tool(
    "add_gift_ideas",
    {
      description:
        "Occasions: add one or more gift ideas for someone, say a list the person gives you for a member's birthday. Pass occasion_id (from get_occasions), or for_user_id for a member and the ideas go under their next birthday, or for_name for someone outside the household. An idea for another member is kept from them by default (they never see it, its watch or its budget line); keep_from_user_ids replaces who it is kept from ([] for nobody). Prices in whole currency units. To add to the person's own wishlist use add_wishlist_items instead; nobody can change another member's wishlist. Not available in the household's shared chat.",
      inputSchema: {
        ideas: z.array(giftItem).min(1).max(30),
        occasion_id: z.string().optional(),
        for_user_id: z.string().optional(),
        for_name: z.string().max(80).optional(),
        keep_from_user_ids: z.array(z.string()).max(20).optional(),
      },
    },
    async ({ ideas, occasion_id, for_user_id, for_name, keep_from_user_ids }) => {
      if (!groupId) return noGroupError();
      // The tool isn't offered there; this guards a call that gets through anyway.
      if (shared) return toolError("Gift ideas can't be added in the household chat, where everyone reads it. Ask in a private chat.");
      const { today, memberIds, occasions } = await occasionsContext(groupId);
      if (for_user_id && !memberIds.includes(for_user_id)) return toolError("That person is not in this household");
      const names = await memberNames(admin, groupId);
      let occasion: Occasion | null = null;
      if (occasion_id) {
        occasion = occasions.find((o) => o.id === occasion_id) ?? null;
        if (!occasion) return toolError("Occasion not found");
      } else if (for_user_id) {
        occasion = wishlistOccasion(for_user_id, occasions, today);
        if (!occasion) {
          return toolError(
            `There is no birthday for ${names.get(for_user_id) ?? "them"} in Occasions yet. Ask for the date and add it with add_occasion, then add the ideas.`,
          );
        }
      } else if (for_name?.trim()) {
        const wanted = for_name.trim().toLowerCase();
        occasion =
          sortOccasions(
            occasions.filter((o) => o.person_name?.trim().toLowerCase() === wanted),
            today,
          )[0] ?? null;
        if (!occasion) return toolError(`No occasion for ${for_name.trim()} yet. Add one with add_occasion first.`);
      } else {
        return toolError("Say who the ideas are for: occasion_id, for_user_id or for_name");
      }
      const forUserId = for_user_id ?? occasion.person_id;
      const forName = forUserId ? null : for_name?.trim() || occasion.person_name;
      const chosen = keep_from_user_ids ?? defaultHiddenFrom(forUserId, userId, memberIds);
      if (chosen.some((id) => !memberIds.includes(id))) return toolError("Someone in keep_from_user_ids is not in this household");
      // An idea for a surprise stays kept from whoever the occasion is kept from, and never from the person adding it.
      const hiddenFrom = [...new Set([...chosen, ...occasion.hidden_from])].filter((id) => id !== userId);
      const rows = ideas.map((idea) =>
        buildGiftIdea({
          id: crypto.randomUUID(),
          groupId,
          title: idea.title,
          occasionId: occasion.id,
          forUserId,
          forName,
          priceCents: priceCents(idea.price),
          url: idea.url ?? null,
          notes: idea.notes ?? null,
          hiddenFrom,
          createdBy: userId,
        }),
      );
      const { error } = await admin.from("gift_ideas").insert(rows);
      if (error) return toolError(error.message);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              occasion: occasion.title,
              added: rows.map((r) => r.title),
              kept_from: hiddenFrom.map((id) => names.get(id) ?? "Someone"),
            }),
          },
        ],
      };
    },
  );

  tool(
    "add_wishlist_items",
    {
      description:
        "Occasions: add things to the person's own wishlist, which everyone in the household can see so they know what to give. Prices in whole currency units. Only the person's own list; for gift ideas for someone else use add_gift_ideas.",
      inputSchema: {
        items: z.array(giftItem).min(1).max(30),
      },
    },
    async ({ items }) => {
      if (!groupId) return noGroupError();
      const rows = items.map((item) =>
        buildWishlistItem({
          id: crypto.randomUUID(),
          groupId,
          userId,
          title: item.title,
          url: item.url ?? null,
          priceCents: priceCents(item.price),
          notes: item.notes ?? null,
        }),
      );
      const { error } = await admin.from("wishlist_items").insert(rows);
      if (error) return toolError(error.message);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, added: rows.map((r) => r.title) }) }] };
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
        // In the shared chat, watches kept from anyone stay out too.
        .filter((w) => !isKeptFrom(w, userId) && !(shared && (w.hidden_from ?? []).length > 0))
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

  tools.push(...moduleTools({ admin, userId, groupId, enabled, shared }));
  // new-module:tool-push (scripts/new-module.mjs adds above this line)

  return tools;
}
