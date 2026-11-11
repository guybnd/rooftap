import { z } from "zod";
import { MAX_EVENT_REMINDER_DAYS, assigneePatch, assigneesOf, type GroupEvent, type EventCategory } from "@homeup/core";
import { basic, DETAIL, fail, notAllMembers, ok, PEOPLE, toolRegistrar, type HouseholdTool, type HouseholdToolContext } from "../tool-kit";

// Native calendar events. A private event is its creator's (tool-data.ts).
// The Google Calendar overlay and appointments are not touched.

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
const EVENT_BASIC = ["id", "title", "category", "starts_at", "ends_at", "is_all_day", "location", "notes"] as const;
/** An event row for the Assistant, with everyone it is for. */
export const eventRow = (e: GroupEvent) => ({ ...basic(e, EVENT_BASIC), assignee_user_ids: assigneesOf(e) });

export function calendarTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { userId } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  const peopleSchema = PEOPLE;
  const eventAssigneeSchema = z
    .string()
    .nullable()
    .optional()
    .describe("One household member (user id) the event is for; null for everyone. For several people use assignee_user_ids.");
  const reminderDaysSchema = z
    .array(z.number().int().min(0).max(MAX_EVENT_REMINDER_DAYS))
    .max(10)
    .optional()
    .describe(
      `Days before the event a reminder goes out (0 = on the day, up to ${MAX_EVENT_REMINDER_DAYS}). Left out on a new event: a week and a day before. [] = no reminders.`,
    );
  const notAMember = async (personId: string | null | undefined) => !!personId && (await notAllMembers(db, [personId]));
  const sortedDays = (days: number[]) => [...new Set(days)].sort((a, b) => b - a);

  tool(
    "get_upcoming_calendar_events",
    {
      description: "Upcoming native Rooftap calendar events visible to the authenticated user (excludes the Google Calendar overlay).",
      inputSchema: {
        days: z.number().int().positive().max(90).optional(),
        detail: DETAIL,
      },
    },
    async ({ days, detail }) => {
      const now = new Date();
      const until = new Date(now.getTime() + (days ?? 30) * 24 * 60 * 60 * 1000);
      const events = await db.rows<GroupEvent>("events", (q) =>
        q.gte("starts_at", now.toISOString()).lte("starts_at", until.toISOString()),
      );
      const shaped = detail === "full" ? events : events.map(eventRow);
      return ok(shaped);
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
        assigned_to: eventAssigneeSchema,
        assignee_user_ids: peopleSchema,
        reminder_days: reminderDaysSchema,
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
      assigned_to,
      assignee_user_ids,
      reminder_days,
    }) => {
      if (await notAMember(assigned_to)) return fail("That person is not in this household");
      if (await notAllMembers(db, assignee_user_ids)) return fail("Someone in assignee_user_ids is not in this household");
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
        ...assigneePatch(assignee_user_ids ?? (assigned_to ? [assigned_to] : []), true),
        ...(reminder_days ? { reminder_days: sortedDays(reminder_days) } : {}),
        deleted: false,
      };
      await db.insert("events", row);
      return ok(row);
    },
    null,
  );

  tool(
    "update_event",
    {
      description:
        "Update fields on an existing native Rooftap calendar event (title, times, category, all-day flag, location, notes, private flag, who it is for, reminders). Only the fields provided are changed; omit a field to leave it as-is.",
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
        assigned_to: eventAssigneeSchema,
        assignee_user_ids: peopleSchema,
        reminder_days: reminderDaysSchema,
      },
    },
    async ({ event_id, reminder_days, assignee_user_ids, ...patch }) => {
      const event = await db.row<GroupEvent>("events", event_id);
      if (!event) return fail("Event not found");
      if (await notAMember(patch.assigned_to)) return fail("That person is not in this household");
      if (await notAllMembers(db, assignee_user_ids)) return fail("Someone in assignee_user_ids is not in this household");
      const updates: Record<string, unknown> = {};
      if (reminder_days) updates.reminder_days = sortedDays(reminder_days);
      // One person by assigned_to replaces the list; assignee_user_ids sets everyone.
      if (assignee_user_ids !== undefined) Object.assign(updates, assigneePatch(assignee_user_ids ?? [], true));
      else if (patch.assigned_to !== undefined) Object.assign(updates, assigneePatch(patch.assigned_to ? [patch.assigned_to] : [], true));
      for (const key of ["title", "starts_at", "ends_at", "category", "is_all_day", "location", "notes", "private"] as const) {
        if (patch[key] !== undefined) updates[key] = patch[key];
      }
      if (Object.keys(updates).length > 0) {
        await db.update("events", event_id, updates);
      }
      return ok({ ok: true, id: event_id });
    },
    null,
  );

  tool(
    "delete_event",
    {
      description: "Soft-delete a native Rooftap calendar event.",
      inputSchema: { event_id: z.string() },
    },
    async ({ event_id }) => {
      const event = await db.row<GroupEvent>("events", event_id);
      if (!event) return fail("Event not found");
      await db.remove("events", event_id);
      return ok({ ok: true, id: event_id });
    },
    null,
  );

  return tools;
}
