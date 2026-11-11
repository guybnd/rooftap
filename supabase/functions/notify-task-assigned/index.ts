// FLUX-128 Phase 2: "assigned to you" push.
// Invoked by a DB trigger (pg_net) on UPDATE OF assigned_to, assignees ON
// household_tasks, fired only when either changes (WHEN clause in the trigger),
// and on INSERT of an assigned task. Everyone newly on the task is told. The
// request body mirrors the Supabase Database Webhook shape:
//   { type: "UPDATE", record: <new row>, old_record: <old row> }
// Modules (.docs/modules.md): sent only while the module that owns the task is
// on (a bill or document reminder's is Costs or Documents).
import { createAdmin, requireServiceRole, sendToUsers } from "../_shared/send-push.ts";
import { createModuleLookup } from "../_shared/modules.ts";
import { addedAssignees } from "../_shared/assignees.ts";
import { assignedTaskPush, type PushTask } from "../_shared/notify-plans.ts";

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  try {
    const body = await req.json().catch(() => null);
    const record = body?.record as PushTask | undefined;
    const oldRecord = body?.old_record as PushTask | undefined;

    // Nothing to do when nobody new is on the task (defensive: the trigger
    // WHEN clause already filters most of this). Checked before the module read.
    if (!record || addedAssignees(oldRecord, record).length === 0) {
      return Response.json({ ok: true, skipped: true });
    }

    const admin = createAdmin();
    const plan = assignedTaskPush(record, oldRecord, await createModuleLookup(admin)(record.group_id));
    if (!plan) return Response.json({ ok: true, skipped: true });
    const { sent, pruned } = await sendToUsers(admin, plan.to, plan.payload);

    return Response.json({ ok: true, sent, pruned });
  } catch (err) {
    console.error("notify-task-assigned failed", err);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
});
