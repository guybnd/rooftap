import { z } from "zod";
import { addDaysISO, binCollections, binNightState, binNamesPhrase, type BinChange, type BinPlan, type BinStream } from "@homeup/core";
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
import { type ToolData } from "../tool-data";

// Bin night: which bins go out, whose turn it is, and one-off changes.

/** The household's bin streams, one-off changes and plan. */
export async function binData(db: ToolData) {
  const [streams, changes, plans] = await Promise.all([
    db.rows<BinStream>("bin_streams"),
    db.rows<BinChange>("bin_changes"),
    db.rows<BinPlan>("bin_plans"),
  ]);
  return { streams, changes, plan: plans[0] ?? null };
}

export function binsTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { admin, userId } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  tool(
    "get_bin_night",
    {
      description:
        "Bin night: which bins go out next, whether tonight is bin night, whether they are already out, and whose turn it is, then the collections after that. Collections are the mornings the truck comes; the bins go out the night before (night_of). Changes such as a public holiday move are already applied. stream ids are for change_bin_collection.",
      inputSchema: {
        weeks: z.number().int().min(1).max(8).optional().describe("How many weeks of collections to list; 3 when left out."),
      },
    },
    async ({ weeks }) => {
      const [{ streams, changes, plan }, today, members] = await Promise.all([
        binData(db),
        personToday(admin, userId),
        names(admin, groupId),
      ]);
      if (streams.length === 0) return ok({ set_up: false });
      const state = binNightState(streams, changes, plan, today);
      const upcoming = binCollections(streams, changes, today, addDaysISO(today, (weeks ?? 3) * 7));
      return ok({
        set_up: true,
        next: state.collection
          ? compact({
              collection: state.collection.date,
              night_of: state.nightOf,
              tonight: state.tonight,
              bins: binNamesPhrase(state.collection.streams),
              out: state.out,
              out_by: state.out ? who(plan?.out_by, userId, members) : null,
              turn: who(state.turn, userId, members),
              notes: state.collection.notes,
            })
          : null,
        upcoming: upcoming.map((c) =>
          compact({
            collection: c.date,
            bins: binNamesPhrase(c.streams),
            moved: c.moved.length ? c.moved.map((m) => ({ bin: streams.find((s) => s.id === m.streamId)?.name, from: m.from })) : null,
            notes: c.notes,
          }),
        ),
        streams: streams.map((s) => ({ id: s.id, name: s.name, lid: s.lid, every_weeks: s.every_weeks })),
      });
    },
    { set_up: false },
  );

  tool(
    "mark_bins_out",
    {
      description:
        "Bin night: mark the next collection's bins as out (out false undoes it). This stops the night-before reminder, the same as tapping Done on the Home card.",
      inputSchema: {
        out: z.boolean().optional(),
      },
    },
    async ({ out }) => {
      const [{ streams, changes, plan }, today] = await Promise.all([binData(db), personToday(admin, userId)]);
      const state = binNightState(streams, changes, plan, today);
      if (!plan || !state.collection) return fail("Bin night isn't set up yet.");
      const patch = out === false ? { out_for: null, out_by: null } : { out_for: state.collection.date, out_by: userId };
      await db.update("bin_plans", plan.id, patch);
      return ok({ ok: true, out: out !== false, collection: state.collection.date, bins: binNamesPhrase(state.collection.streams) });
    },
    null,
  );

  tool(
    "change_bin_collection",
    {
      description:
        "Bin night: record a one-off change, such as a public holiday. date is the day the collection was due. moved_to is the new day, or null when there is no collection that day. stream_id (from get_bin_night) limits it to one bin; leave it out to move every bin due that day. For an extra collection, pass the stream_id with date and moved_to both set to the extra day.",
      inputSchema: {
        date: ISO_DATE,
        moved_to: ISO_DATE.nullable(),
        stream_id: z.string().optional(),
        note: z.string().max(200).optional(),
      },
    },
    async ({ date, moved_to, stream_id, note }) => {
      const streams = await db.rows<BinStream>("bin_streams");
      if (streams.length === 0) return fail("Bin night isn't set up yet.");
      if (stream_id && !streams.some((s) => s.id === stream_id)) return fail("No such bin.");
      const row = {
        id: crypto.randomUUID(),
        group_id: groupId,
        stream_id: stream_id ?? null,
        on_date: date,
        moved_to,
        note: note?.trim() || null,
        source: "manual",
        created_by: userId,
        deleted: false,
      };
      await db.insert("bin_changes", row);
      return ok({ ok: true, id: row.id, date, moved_to });
    },
    null,
  );

  return tools;
}
