import { z } from "zod";
import {
  isTaskOwnerEnabled,
  applyTaskCompletion,
  anchorRepeatRule,
  approxRepeatDays,
  firstRepeatDate,
  formatRepeatRule,
  parseRepeatRule,
  taskRepeatLabel,
  assigneePatch,
  assigneesOf,
  isAssignedTo,
  type ModuleId,
  type HouseholdTask,
} from "@homeup/core";
import { memberNames } from "@/lib/member-names";
import { personTimeZone, todayIn } from "@/lib/meal-plan-server";
import { basic, DETAIL, fail, notAllMembers, ok, PEOPLE, toolRegistrar, type HouseholdTool, type HouseholdToolContext } from "../tool-kit";
import { type ToolData } from "../tool-data";

// To-dos. A private to-do is its assignee's (tool-data.ts). A bill or
// document reminder whose module is off doesn't exist either
// (.docs/modules.md), the same as in the app.

export const TASK_BASIC = [
  "id",
  "title",
  "due_date",
  "due_time",
  "done",
  "completed_at",
  "priority",
  "notes",
  "recurrence_days",
  "repeat_rule",
] as const;

const REPEAT_RULE_HELP =
  "How it repeats, as an iCalendar RRULE (what Google Calendar uses). The 1st of every month: FREQ=MONTHLY;BYMONTHDAY=1. The first Sunday of the month: FREQ=MONTHLY;BYDAY=1SU. The last day of the month: FREQ=MONTHLY;BYMONTHDAY=-1. The last Friday: FREQ=MONTHLY;BYDAY=-1FR. Every Monday: FREQ=WEEKLY;BYDAY=MO. Every 2 weeks on Monday and Thursday: FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH. Every weekday: FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR. Every 3 months on the 15th: FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15. Every year on 1 November: FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1. Add UNTIL=YYYYMMDD to end on a date or COUNT=n to stop after n times. null stops repeating.";

/**
 * A repeat rule from the Assistant, checked and anchored on the due date: the
 * due date moves to the first day the rule falls on (today when there is none).
 */
function readRepeatRule(
  text: string,
  dueDate: string | null,
  today: string,
): { rule: string; days: number; dueDate: string } | { error: string } {
  const parsed = parseRepeatRule(text);
  if (!parsed)
    return {
      error: `Can't read repeat_rule "${text}". Use an RRULE such as FREQ=MONTHLY;BYMONTHDAY=1 or FREQ=MONTHLY;BYDAY=1SU.`,
    };
  const from = dueDate ?? today;
  const rule = anchorRepeatRule(parsed, from);
  const first = firstRepeatDate(rule, from);
  if (!first) return { error: "That repeat rule ends before the due date." };
  return { rule: formatRepeatRule(rule), days: approxRepeatDays(rule), dueDate: first };
}

/** The household's to-dos this person may see, of switched-on modules. */
export async function liveTasks(
  db: ToolData,
  enabled: ReadonlySet<ModuleId>,
  where?: Parameters<ToolData["rows"]>[1],
): Promise<HouseholdTask[]> {
  return (await db.rows<HouseholdTask>("household_tasks", where)).filter((t) => isTaskOwnerEnabled(t, enabled));
}

export function tasksTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { admin, userId, enabled } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  const findTask = async (id: string) => (await liveTasks(db, enabled, (q) => q.eq("id", id)))[0] ?? null;
  const peopleSchema = PEOPLE;

  tool(
    "get_tasks",
    {
      description:
        "Household to-dos visible to the authenticated user. Pass done false for what's still open, or done true for what got done: done ones come newest first with completed_at and who ticked it off (completed_by). repeats says how often a to-do repeats in words (repeat_rule is the calendar rule, recurrence_days its rough day count); ticking off a repeating one makes the next. Each task says whether it's assigned to you.",
      inputSchema: {
        done: z.boolean().optional(),
        search: z.string().optional().describe('Only to-dos whose title contains this text, any case (say "bins").'),
        completed_since: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("YYYY-MM-DD: only to-dos ticked off on or after this day."),
        detail: DETAIL,
      },
    },
    async ({ done, search, completed_since, detail }) => {
      const needle = search?.trim().toLowerCase();
      const tasks = (await liveTasks(db, enabled))
        .filter((t) => done === undefined || t.done === done)
        .filter((t) => !needle || t.title.toLowerCase().includes(needle))
        .filter((t) => !completed_since || (!!t.completed_at && t.completed_at.slice(0, 10) >= completed_since))
        .sort((a, b) => Number(a.done) - Number(b.done) || (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
      if (detail === "full") return ok(tasks);
      const names = tasks.some((t) => t.completed_by) ? await memberNames(admin, groupId).catch(() => new Map<string, string>()) : null;
      const shaped = tasks.map((t) => ({
        ...basic(t, TASK_BASIC),
        ...(taskRepeatLabel(t) ? { repeats: taskRepeatLabel(t) } : {}),
        assigned_to_me: isAssignedTo(t, userId),
        assignee_user_ids: assigneesOf(t),
        ...(t.completed_by
          ? {
              completed_by: t.completed_by === userId ? "you" : (names?.get(t.completed_by) ?? "someone"),
            }
          : {}),
      }));
      return ok(shaped);
    },
  );

  tool(
    "create_task",
    {
      description:
        "Create a new household to-do, assigned to the authenticated user unless assignee_user_ids says who it is for (several people allowed). For one that repeats set repeat_rule, a calendar rule that lands on real dates (the 1st of every month, the first Sunday, every Tuesday); the due date moves to the first day the rule falls on.",
      inputSchema: {
        title: z.string().min(1),
        due_date: z.string().optional(),
        due_time: z.string().optional(),
        notes: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        private: z.boolean().optional(),
        assignee_user_ids: peopleSchema,
        repeat_every_days: z
          .number()
          .int()
          .min(1)
          .max(366)
          .nullable()
          .optional()
          .describe(
            "Repeat every this many days, for a plain day count (every 3 days). For weeks, months and years use repeat_rule instead. null stops repeating.",
          ),
        repeat_rule: z.string().nullable().optional().describe(REPEAT_RULE_HELP),
      },
    },
    async ({ title, due_date, due_time, notes, priority, private: isPrivate, assignee_user_ids, repeat_every_days, repeat_rule }) => {
      if (isPrivate && assignee_user_ids?.length) return fail("A private to-do is only for you, so it can't have other people on it.");
      if (await notAllMembers(db, assignee_user_ids)) return fail("Someone in assignee_user_ids is not in this household");
      const repeat = repeat_rule ? readRepeatRule(repeat_rule, due_date ?? null, todayIn(await personTimeZone(admin, userId))) : null;
      if (repeat && "error" in repeat) return fail(repeat.error);
      const id = crypto.randomUUID();
      const row: Record<string, unknown> = {
        id,
        group_id: groupId,
        title,
        due_date: repeat ? repeat.dueDate : (due_date ?? null),
        due_time: due_time ?? null,
        offset_days: null,
        recurrence_days: repeat ? repeat.days : (repeat_every_days ?? null),
        ...(repeat ? { repeat_rule: repeat.rule } : {}),
        done: false,
        completed_at: null,
        ...(assignee_user_ids != null && !isPrivate ? assigneePatch(assignee_user_ids, true) : { assigned_to: userId }),
        private: isPrivate ?? false,
        template_key: null,
        notes: notes ?? null,
        sort_order: 0,
        deleted: false,
      };
      if (priority) row.priority = priority;
      await db.insert("household_tasks", row);
      return ok({
        ...row,
        priority: priority ?? "medium",
        ...(repeat ? { repeats: taskRepeatLabel(row as { repeat_rule: string; recurrence_days: number }) } : {}),
      });
    },
    null,
  );

  tool(
    "update_task",
    {
      description:
        "Update fields on an existing household to-do (title, due date/time, notes, priority, private flag, who it is for, how often it repeats). Only the fields provided are changed; omit a field to leave it as-is. repeat_rule null (or repeat_every_days null) stops it repeating.",
      inputSchema: {
        task_id: z.string(),
        title: z.string().min(1).optional(),
        due_date: z.string().nullable().optional(),
        due_time: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        private: z.boolean().optional(),
        assignee_user_ids: peopleSchema,
        repeat_every_days: z
          .number()
          .int()
          .min(1)
          .max(366)
          .nullable()
          .optional()
          .describe(
            "Repeat every this many days, for a plain day count (every 3 days). For weeks, months and years use repeat_rule instead. null stops repeating.",
          ),
        repeat_rule: z.string().nullable().optional().describe(REPEAT_RULE_HELP),
      },
    },
    async ({ task_id, repeat_every_days, repeat_rule, assignee_user_ids, ...patch }) => {
      const task = await findTask(task_id);
      if (!task) return fail("Task not found");
      if (assignee_user_ids !== undefined && (patch.private ?? task.private))
        return fail("A private to-do is only for you, so it can't have other people on it.");
      if (await notAllMembers(db, assignee_user_ids)) return fail("Someone in assignee_user_ids is not in this household");
      const updates: Record<string, unknown> = {};
      if (assignee_user_ids !== undefined) Object.assign(updates, assigneePatch(assignee_user_ids ?? [], true));
      for (const key of ["title", "due_date", "due_time", "notes", "priority", "private"] as const) {
        if (patch[key] !== undefined) updates[key] = patch[key];
      }
      if (repeat_rule) {
        const due = patch.due_date !== undefined ? patch.due_date : task.due_date;
        const repeat = readRepeatRule(repeat_rule, due, todayIn(await personTimeZone(admin, userId)));
        if ("error" in repeat) return fail(repeat.error);
        updates.repeat_rule = repeat.rule;
        updates.recurrence_days = repeat.days;
        updates.due_date = repeat.dueDate;
      } else if (repeat_rule === null || repeat_every_days !== undefined) {
        // A day count, or stopping: the calendar rule goes too.
        updates.recurrence_days = repeat_rule === null && repeat_every_days === undefined ? null : (repeat_every_days ?? null);
        updates.repeat_rule = null;
      }
      if (Object.keys(updates).length > 0) {
        await db.update("household_tasks", task_id, updates);
      }
      return ok({ ok: true, id: task_id });
    },
    null,
  );

  tool(
    "complete_task",
    {
      description: "Mark a household to-do done or not done. Ticking off a repeating to-do makes its next one, as the app does.",
      inputSchema: { task_id: z.string(), done: z.boolean() },
    },
    async ({ task_id, done }) => {
      const task = await findTask(task_id);
      if (!task) return fail("Task not found");
      // Already in that state: change nothing, so a repeat never makes a second next one.
      if (task.done === done) return ok({ ok: true, id: task_id, done });
      const { update, createNextOccurrence } = applyTaskCompletion(task, done, {
        nextId: crypto.randomUUID(),
      });
      // The service role has no signed-in person for the trigger to read, so say who.
      await db.update("household_tasks", task_id, { ...update, completed_by: done ? userId : null });
      let next: { id: string; due_date: string | null } | undefined;
      if (createNextOccurrence) {
        // The database stamps the times.
        const row: Partial<HouseholdTask> = { ...createNextOccurrence };
        delete row.created_at;
        delete row.updated_at;
        await db.insert("household_tasks", row);
        next = {
          id: createNextOccurrence.id,
          due_date: createNextOccurrence.due_date,
        };
      }
      return ok({
        ok: true,
        id: task_id,
        done,
        ...(next ? { next } : {}),
      });
    },
    null,
  );

  tool(
    "delete_task",
    {
      description: "Soft-delete a household to-do.",
      inputSchema: { task_id: z.string() },
    },
    async ({ task_id }) => {
      const task = await findTask(task_id);
      if (!task) return fail("Task not found");
      await db.remove("household_tasks", task_id);
      return ok({ ok: true, id: task_id });
    },
    null,
  );

  return tools;
}
