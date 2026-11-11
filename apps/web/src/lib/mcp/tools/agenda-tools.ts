import { z } from "zod";
import {
  billsDue,
  addDaysISO,
  toISODate,
  assigneesOf,
  isAssignedTo,
  CATEGORY_META,
  mealDishesByDate,
  type MealPlanEntry,
  nextOccasionDay,
  type HouseholdTask,
  type GroupEvent,
  type Recipe,
  type Occasion,
  binCollections,
  binNightState,
  binNamesPhrase,
  dishesTitle,
  liveCareJobs,
  sortByDue,
  type CareJob,
  occasionTitle,
} from "@homeup/core";
import { householdCostMonth } from "@/lib/cost-month-server";
import { basic, compact, names, ok, toolRegistrar, who, type HouseholdTool, type HouseholdToolContext, type Row } from "../tool-kit";
import { type ToolData } from "../tool-data";
import { binData } from "./bins-tools";
import { eventRow } from "./calendar-tools";
import { liveTasks, TASK_BASIC } from "./tasks-tools";

// get_agenda: what's due across the household in the next days, from every
// switched-on module, each part under its own table's privacy rule.

export function agendaTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { admin, userId, enabled } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  tool(
    "get_agenda",
    {
      description:
        'What\'s due across the household in the next days, in one answer: open to-dos due (and overdue ones), calendar events, bills from Costs with their usual amount, bin nights (night_of is the evening they go out), Home care jobs due, the planned dinners, and birthdays and other occasions. Use it for "what\'s due this week" and "what\'s on today". Parts whose module is off are left out. Amounts in cents.',
      inputSchema: {
        days: z.number().int().positive().max(31).optional().describe("How many days ahead, today included; 7 when left out."),
      },
    },
    async ({ days }) => {
      const span = days ?? 7;
      const costsOn = enabled.has("costs");
      const cost = costsOn ? await householdCostMonth(admin, userId, groupId) : null;
      // The person's today: Costs already works it out from their time zone.
      const today = cost ? toISODate(cost.today) : new Date().toISOString().slice(0, 10);
      const last = addDaysISO(today, span - 1);
      const out: Record<string, unknown> = { from: today, to: last };
      if (enabled.has("household")) {
        const open = (await liveTasks(db, enabled, (q) => q.eq("done", false)))
          .filter((t) => t.due_date && t.due_date <= last)
          .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
        const row = (t: HouseholdTask) => ({
          ...basic(t, TASK_BASIC),
          assigned_to_me: isAssignedTo(t, userId),
          assignee_user_ids: assigneesOf(t),
        });
        out.overdue_tasks = open.filter((t) => t.due_date! < today).map(row);
        out.tasks = open.filter((t) => t.due_date! >= today).map(row);
      }
      if (enabled.has("calendar")) {
        const events = await db.rows<GroupEvent>("events", (q) =>
          q
            .gte("starts_at", new Date(Date.now() - 12 * 3600_000).toISOString())
            .lte("starts_at", new Date(Date.now() + (span + 1) * 86_400_000).toISOString()),
        );
        out.events = events.sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map(eventRow);
      }
      if (cost) {
        out.bills = billsDue(cost.items, cost.links, cost.today, span - 1).map((b) => ({
          name: b.item.name,
          due: toISODate(b.due),
          amount_cents: b.amountCents,
          ...(b.item.is_estimate ? { estimate: true } : {}),
          category: CATEGORY_META[b.item.category]?.label ?? b.item.category,
          cost_item_id: b.item.id,
        }));
      }
      Object.assign(out, await agendaExtras({ admin, db, userId, groupId, enabled }, today, last));
      return ok(out);
    },
    { tasks: [], events: [], bills: [] },
  );

  return tools;
}

/**
 * What the newer modules add to get_agenda between `today` and `last`: bin
 * nights, Home care jobs due, the planned dinners, and occasions. Each part
 * only while its module is on, and a part that fails is left out rather
 * than failing the whole agenda.
 */
export async function agendaExtras(
  ctx: Pick<HouseholdToolContext, "admin" | "userId" | "enabled"> & { db: ToolData; groupId: string },
  today: string,
  last: string,
): Promise<Row> {
  const { admin, db, userId, groupId, enabled } = ctx;
  const out: Row = {};
  const needNames = enabled.has("bins") || enabled.has("meals");
  const members = needNames ? await names(admin, groupId) : new Map<string, string>();
  await Promise.all([
    enabled.has("bins") &&
      binData(db)
        .then(({ streams, changes, plan }) => {
          const nights = binCollections(streams, changes, addDaysISO(today, 1), addDaysISO(last, 1));
          const state = binNightState(streams, changes, plan, today);
          if (nights.length === 0) return;
          out.bin_nights = nights.map((c) => ({
            night_of: addDaysISO(c.date, -1),
            collection: c.date,
            bins: binNamesPhrase(c.streams),
            ...(state.collection?.date === c.date && state.out ? { out: true } : {}),
            ...(c.notes.length ? { notes: c.notes } : {}),
          }));
        })
        .catch(() => {}),
    enabled.has("home-care") &&
      db
        .rows<CareJob>("care_jobs")
        .then((rows) => {
          const due = sortByDue(liveCareJobs(rows)).filter((j) => j.state === "active" && j.next_due && j.next_due <= last);
          if (due.length === 0) return;
          out.home_care = due.map((j) =>
            compact({ id: j.id, title: j.title, room: j.room, due: j.next_due, overdue: j.next_due! < today || undefined }),
          );
        })
        .catch(() => {}),
    enabled.has("meals") &&
      enabled.has("recipes") &&
      Promise.all([db.rows<MealPlanEntry>("meal_plan_entries"), db.rows<Recipe>("recipes")])
        .then(([entries, recipes]) => {
          const byId = new Map(recipes.map((r) => [r.id, r]));
          const nights = [...mealDishesByDate(entries.filter((e) => e.date >= today && e.date <= last))].sort(([a], [b]) =>
            a.localeCompare(b),
          );
          if (nights.length === 0) return;
          out.dinners = nights.map(([date, dishes]) =>
            compact({
              date,
              dinner: dishesTitle(dishes, byId) ?? dishes.find((d) => d.label)?.label ?? null,
              cook: who(dishes.find((d) => d.cook_user_id)?.cook_user_id, userId, members),
            }),
          );
        })
        .catch(() => {}),
    // Birthdays and other days. Kept ones stay out like in get_occasions; gift ideas never show here.
    enabled.has("occasions") &&
      db
        .rows<Occasion>("occasions")
        .then((rows) => {
          const days = rows
            .map((o) => ({ o, day: nextOccasionDay(o, today) }))
            .filter((x): x is { o: Occasion; day: string } => !!x.day && x.day <= last)
            .sort((a, b) => a.day.localeCompare(b.day));
          if (days.length === 0) return;
          out.occasions = days.map(({ o, day }) => ({ id: o.id, title: occasionTitle(o, userId), date: day, kind: o.kind }));
        })
        .catch(() => {}),
  ]);
  return out;
}
