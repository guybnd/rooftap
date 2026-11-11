import { z } from "zod";
import {
  norm,
  CARE_AREAS,
  careDonePatch,
  careDue,
  careEveryLabel,
  careJobFromSuggestion,
  careSkipPatch,
  careSnoozePatch,
  careStatePatch,
  careSuggestionsFor,
  isSouthernHemisphere,
  liveCareJobs,
  newCareJobFields,
  sortByDue,
  type CareArea,
  type CareJob,
  type CareUnit,
} from "@homeup/core";
import {
  compact,
  fail,
  ISO_DATE,
  names,
  ok,
  personToday,
  toolRegistrar,
  who,
  type HouseholdTool,
  type HouseholdToolContext,
} from "../tool-kit";

// Home care: the household's upkeep jobs.

export function homeCareTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { admin, userId } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  const findCareJob = (id: string) => db.row<CareJob>("care_jobs", id);

  async function careRegion(): Promise<string | null> {
    return (await db.group<{ region?: string | null }>("region"))?.region ?? null;
  }

  tool(
    "get_care_jobs",
    {
      description:
        "Home care: the household's upkeep jobs (smoke alarms, gutters, filters...), with how often, when each is next due, and when it was last done. Due soon and overdue first. Pass room to narrow it. include_suggestions lists the built-in jobs not added yet, with their suggestion_id for add_care_job.",
      inputSchema: {
        room: z.string().optional(),
        include_paused: z.boolean().optional(),
        include_suggestions: z.boolean().optional(),
      },
    },
    async ({ room, include_paused, include_suggestions }) => {
      const [rows, today, region, members] = await Promise.all([
        db.rows<CareJob>("care_jobs"),
        personToday(admin, userId),
        careRegion(),
        names(admin, groupId),
      ]);
      const southern = isSouthernHemisphere(region);
      const jobs = sortByDue(liveCareJobs(rows))
        .filter((j) => j.state === "active" || (include_paused && j.state === "paused"))
        .filter((j) => !room || norm(j.room ?? "") === norm(room));
      const taken = new Set(rows.filter((j) => !j.deleted && j.suggestion_id).map((j) => j.suggestion_id));
      return ok({
        today,
        jobs: jobs.map((j) =>
          compact({
            id: j.id,
            title: j.title,
            room: j.room,
            area: j.area,
            state: j.state === "active" ? null : j.state,
            every: careEveryLabel(j, southern),
            next_due: j.next_due,
            due: careDue(j, today)?.text ?? null,
            last_done: j.last_done,
            assigned_to: who(j.assigned_to, userId, members),
            notes: j.notes,
          }),
        ),
        ...(include_suggestions
          ? {
              suggestions: careSuggestionsFor(region)
                .filter((s) => !taken.has(s.id))
                .map((s) => compact({ suggestion_id: s.id, title: s.title, room: s.room, why: s.why })),
            }
          : {}),
      });
    },
    { jobs: [] },
  );

  tool(
    "update_care_job",
    {
      description:
        "Home care: act on one job (id from get_care_jobs). action done records it done (done_on, today when left out) and works out the next due date; skip moves to the next due date without logging it; snooze pushes it back snooze_days (7 when left out); pause, resume and hide switch it off and on. Without action, changes its settings: how often (every_n with every_unit), who looks after it (assigned_to_user_id, null for nobody), reminder days before, notes.",
      inputSchema: {
        job_id: z.string(),
        action: z.enum(["done", "skip", "snooze", "pause", "resume", "hide"]).optional(),
        done_on: ISO_DATE.optional(),
        snooze_days: z.number().int().min(1).max(365).optional(),
        every_n: z.number().int().min(1).max(999).optional(),
        every_unit: z.enum(["day", "week", "month", "year"]).optional(),
        assigned_to_user_id: z.string().nullable().optional(),
        remind_days_before: z.number().int().min(0).max(90).optional(),
        notes: z.string().max(1000).nullable().optional(),
      },
    },
    async (args) => {
      const [job, today] = await Promise.all([findCareJob(args.job_id), personToday(admin, userId)]);
      if (!job) return fail("Care job not found");
      let patch: Partial<CareJob> = {};
      if (args.action === "done") patch = careDonePatch(job, args.done_on ?? today, userId);
      else if (args.action === "skip") patch = careSkipPatch(job, today);
      else if (args.action === "snooze") patch = careSnoozePatch(job, today, args.snooze_days ?? 7);
      else if (args.action)
        patch = careStatePatch(job, args.action === "resume" ? "active" : args.action === "pause" ? "paused" : "hidden", today);
      if (args.assigned_to_user_id !== undefined) {
        if (args.assigned_to_user_id && !(await names(admin, groupId)).has(args.assigned_to_user_id))
          return fail("That person isn't in this household.");
        patch.assigned_to = args.assigned_to_user_id;
      }
      if (args.remind_days_before !== undefined) patch.remind_days_before = args.remind_days_before;
      if (args.notes !== undefined) patch.notes = args.notes?.trim() || null;
      if (args.every_n !== undefined || args.every_unit !== undefined) {
        const schedule = {
          every_n: args.every_n ?? job.every_n,
          every_unit: (args.every_unit ?? job.every_unit) as CareUnit,
          season_month: null,
        };
        Object.assign(patch, schedule);
      }
      if (Object.keys(patch).length === 0) return fail("Nothing to change.");
      await db.update("care_jobs", job.id, patch);
      return ok(compact({ ok: true, id: job.id, title: job.title, next_due: patch.next_due ?? job.next_due, state: patch.state }));
    },
    null,
  );

  tool(
    "add_care_job",
    {
      description:
        'Home care: add an upkeep job. Pass suggestion_id (from get_care_jobs with include_suggestions) for a built-in job with its usual schedule, or a title with every_n and every_unit ("clean the dryer vent every 6 months"). area is one of ' +
        CARE_AREAS.map((a) => a.id).join(", ") +
        ".",
      inputSchema: {
        suggestion_id: z.string().optional(),
        title: z.string().min(1).max(200).optional(),
        every_n: z.number().int().min(1).max(999).optional(),
        every_unit: z.enum(["day", "week", "month", "year"]).optional(),
        area: z.enum(CARE_AREAS.map((a) => a.id) as [CareArea, ...CareArea[]]).optional(),
        room: z.string().max(100).optional(),
      },
    },
    async ({ suggestion_id, title, every_n, every_unit, area, room }) => {
      const [today, region, rows] = await Promise.all([personToday(admin, userId), careRegion(), db.rows<CareJob>("care_jobs")]);
      let fields: ReturnType<typeof newCareJobFields>;
      if (suggestion_id) {
        const s = careSuggestionsFor(region).find((x) => x.id === suggestion_id);
        if (!s) return fail("No such suggestion.");
        if (rows.some((j) => j.suggestion_id === s.id)) return fail(`${s.title} is already in Home care.`);
        fields = careJobFromSuggestion(s, isSouthernHemisphere(region), today);
      } else {
        if (!title?.trim() || !every_unit) return fail("Pass suggestion_id, or a title with every_n and every_unit.");
        fields = newCareJobFields({ title, area, room: room ?? null, every_n: every_n ?? 1, every_unit }, today);
      }
      const row = { id: crypto.randomUUID(), group_id: groupId, created_by: userId, deleted: false, ...fields };
      await db.insert("care_jobs", row);
      return ok({ ok: true, id: row.id, title: row.title, next_due: row.next_due });
    },
    null,
  );

  return tools;
}
