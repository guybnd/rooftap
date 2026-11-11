import { z } from "zod";
import {
  withPriceChange,
  CATEGORY_META,
  type CostMonthCategory,
  type CostMonthLine,
  type CostItem,
  type CostCategory,
  type CostCadence,
  costInsights,
  costTargets,
  monthKeys,
} from "@homeup/core";
import { householdCostMonth, householdCostMonths } from "@/lib/cost-month-server";
import { compact, fail, ok, toolRegistrar, type HouseholdTool, type HouseholdToolContext } from "../tool-kit";

// Costs: the month's budget, cost lines and the "Worth a look" insights.
// Cost lines have no per-person rule: every member manages them.

const COST_CATEGORIES = Object.keys(CATEGORY_META) as [CostCategory, ...CostCategory[]];
const COST_CADENCES: [CostCadence, ...CostCadence[]] = ["weekly", "fortnightly", "monthly", "quarterly", "yearly", "one_off"];

/** A Costs category from its id (outing) or its label (Going out), any case. */
export function costCategoryFrom(value: string): CostCategory | null {
  const v = value.trim().toLowerCase();
  return COST_CATEGORIES.find((c) => c === v || CATEGORY_META[c].label.toLowerCase() === v) ?? null;
}

/** The Costs categories a person can pick, for tool descriptions. */
export const CATEGORY_CHOICES = COST_CATEGORIES.filter((c) => c !== "income")
  .map((c) => `${CATEGORY_META[c].label} (${c})`)
  .join(", ");

export function costsTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { admin, userId, enabled } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

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
      const { month: m, items, goalCents } = await householdCostMonth(admin, userId, groupId, month);
      const label = (c: string | null) => (c ? (CATEGORY_META[c as keyof typeof CATEGORY_META]?.label ?? c) : "No category yet");
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
        ...(c.lines.length > LINES ? { more_lines: c.lines.length - LINES } : {}),
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
      return ok(body);
    },
    { paid_cents: 0, categories: [] },
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
        cadence: z.enum(COST_CADENCES).optional().describe("How often it repeats; one_off when left out."),
        is_estimate: z.boolean().optional(),
      },
    },
    async ({ name, amount, category, provider, start_date, notes, cadence, is_estimate }) => {
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
      await db.insert("cost_items", row);
      return ok(row);
    },
    null,
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
          .describe("true archives the line: it stays so bank payments still find it, but it leaves every total. false brings it back."),
        price_from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("With price_cents: the day a recurring line's new price starts, YYYY-MM-DD. Earlier dates keep the old price."),
        price_cents: z.number().int().nonnegative().optional().describe("With price_from: the new price in cents."),
      },
    },
    async ({ cost_item_id, archived, price_from, price_cents, ...patch }) => {
      const item = await db.row<CostItem>("cost_items", cost_item_id);
      if (!item) return fail("Cost item not found");
      const updates: Record<string, unknown> = {};
      if (archived !== undefined) updates.archived = archived;
      if ((price_from === undefined) !== (price_cents === undefined)) return fail("Send price_from and price_cents together.");
      if (price_from !== undefined && price_cents !== undefined) {
        updates.price_changes = withPriceChange(item.price_changes ?? [], price_from, price_cents);
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
        await db.update("cost_items", cost_item_id, updates);
      }
      return ok({ ok: true, id: cost_item_id });
    },
    null,
  );

  tool(
    "delete_cost_item",
    {
      description: "Soft-delete a household cost line.",
      inputSchema: { cost_item_id: z.string() },
    },
    async ({ cost_item_id }) => {
      const item = await db.row<CostItem>("cost_items", cost_item_id);
      if (!item) return fail("Cost item not found");
      await db.remove("cost_items", cost_item_id);
      return ok({ ok: true, id: cost_item_id });
    },
    null,
  );

  tool(
    "get_money_insights",
    {
      description:
        'Money insights: what the Costs page\'s "Worth a look" card says: price rises, bills ending, subscriptions to rethink (with overlaps such as two streaming services), categories running ahead or under, and the monthly goal. Each has a group (heads-up, save, reconsider, going-well), a title and a detail line. subscriptions lists every subscription with its monthly cost in cents, and whether the person decided to keep it (kept) or cancel it (cancelling) and when it comes back to decide (ask_again_at). Insights the person hid are left out.',
    },
    async () => {
      if (!enabled.has("costs")) return fail("Costs is switched off.");
      const data = await householdCostMonths(admin, userId, groupId, (wall) => monthKeys(wall, -3, 4));
      const targets = costTargets(data.items);
      const result = costInsights({
        items: data.items.filter((i) => !i.deleted && !targets.has(i.id)),
        months: data.months,
        goalCents: data.goalCents,
        marks: data.marks,
        now: data.now,
      });
      return ok({
        insights: result.insights.map((i) =>
          compact({ group: i.group, title: i.title, detail: i.detail, figure: i.figure?.text, cost_item_id: i.item?.id }),
        ),
        subscriptions: result.subscriptions.map((s) =>
          compact({
            name: s.name,
            monthly_cents: s.monthlyCents,
            kept: s.kept || null,
            cancelling: s.cancelling || null,
            ask_again_at: s.askAgainAt,
            overlap: s.overlap,
            was_cents: s.wasCents,
          }),
        ),
      });
    },
    { insights: [], subscriptions: [] },
  );

  return tools;
}
