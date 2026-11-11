// Bin night push. Invoked every 15 minutes by pg_cron (migration
// 20261023110000_bins). For each household with a bin plan, it works out the
// wall clock in the plan's time zone; once it is past the push time (9 pm by
// default) on the night before a collection, and the bins aren't marked out,
// it pushes whoever's turn it is (or everyone, with no rotation), once per
// collection: bin_night_pushes records it.
//
// Modules: nothing is sent with Bin night off.
import { createAdmin, requireServiceRole, sendToUsers } from "../_shared/send-push.ts";
import { createModuleLookup } from "../_shared/modules.ts";
import { addDaysISO, binsCollectedOn, type TwinChange, type TwinStream } from "../_shared/bin-schedule.ts";
import { binNightCollection, binNightPush, binNightReaders, type BinPlanRow } from "../_shared/notify-plans.ts";

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  try {
    const admin = createAdmin();
    const now = new Date();
    const { data, error } = await admin
      .from("bin_plans")
      .select("group_id, push_at, rotation, rotation_anchor, out_for, timezone")
      .eq("deleted", false)
      .not("push_at", "is", null);
    if (error) throw error;

    const modulesFor = createModuleLookup(admin);
    let sent = 0;
    let pruned = 0;
    let nights = 0;
    const seen = new Set<string>();
    for (const plan of (data ?? []) as BinPlanRow[]) {
      if (seen.has(plan.group_id) || !plan.push_at) continue;
      seen.add(plan.group_id);
      const collection = binNightCollection(plan, now);
      if (!collection) continue;
      if (!(await modulesFor(plan.group_id)).has("bins")) continue;

      const [{ data: streams, error: streamsError }, { data: changes, error: changesError }] = await Promise.all([
        admin.from("bin_streams").select("id, name, weekday, every_weeks, anchor_date, sort_order").eq("group_id", plan.group_id).eq("deleted", false),
        admin
          .from("bin_changes")
          .select("stream_id, on_date, moved_to")
          .eq("group_id", plan.group_id)
          .eq("deleted", false)
          .gte("on_date", addDaysISO(collection, -15))
          .lte("on_date", addDaysISO(collection, 15)),
      ]);
      if (streamsError) throw streamsError;
      if (changesError) throw changesError;
      const bins = binsCollectedOn((streams ?? []) as TwinStream[], (changes ?? []) as TwinChange[], collection);
      if (bins.length === 0) continue;

      const { data: already } = await admin
        .from("bin_night_pushes")
        .select("collection_date")
        .eq("group_id", plan.group_id)
        .eq("collection_date", collection)
        .maybeSingle();
      if (already) continue;

      let members: string[] = [];
      if (!(plan.rotation ?? []).length) {
        const { data: rows, error: membersError } = await admin.from("group_members").select("user_id").eq("group_id", plan.group_id);
        if (membersError) throw membersError;
        members = (rows ?? []).map((m) => m.user_id as string);
      }
      const readers = binNightReaders(plan, collection, members);
      if (readers.length === 0) continue;

      // Record first: a failed send shouldn't make the next run push twice.
      const { error: markError } = await admin
        .from("bin_night_pushes")
        .upsert({ group_id: plan.group_id, collection_date: collection, sent_at: now.toISOString() }, { onConflict: "group_id,collection_date" });
      if (markError) throw markError;
      nights += 1;

      const result = await sendToUsers(admin, readers, binNightPush(plan.group_id, collection, bins));
      sent += result.sent;
      pruned += result.pruned;
    }
    return Response.json({ ok: true, nights, sent, pruned });
  } catch (err) {
    console.error("notify-bin-night failed", err);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
});
