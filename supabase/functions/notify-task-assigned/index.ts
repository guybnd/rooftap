// FLUX-128 Phase 2: "assigned to you" push.
// Invoked by a DB trigger (pg_net) on UPDATE OF assigned_to ON household_tasks,
// fired only when assigned_to actually changes (WHEN clause in the trigger). The
// request body mirrors the Supabase Database Webhook shape:
//   { type: "UPDATE", record: <new row>, old_record: <old row> }
// Modules (.docs/modules.md): sent only while the module that owns the task is
// on (a bill or document reminder's is Costs or Documents).
import {
  createAdmin,
  requireServiceRole,
  sendToUsers,
  type PushPayload,
} from "../_shared/send-push.ts";
import { createModuleLookup, taskOpenHref } from "../_shared/modules.ts";

interface TaskRow {
  id: string;
  group_id: string;
  template_key: string | null;
  title: string;
  assigned_to: string | null;
}

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  try {
    const body = await req.json().catch(() => null);
    const record = body?.record as TaskRow | undefined;
    const oldRecord = body?.old_record as TaskRow | undefined;

    const newAssignee = record?.assigned_to ?? null;
    // Nothing to do if unassigned or assignee unchanged (defensive — the trigger
    // WHEN clause already filters this).
    if (!record || !newAssignee || newAssignee === oldRecord?.assigned_to) {
      return Response.json({ ok: true, skipped: true });
    }

    const admin = createAdmin();
    const enabled = await createModuleLookup(admin)(record.group_id);
    const url = taskOpenHref(record, enabled);
    if (!url) return Response.json({ ok: true, skipped: true });
    const payload: PushPayload = {
      title: enabled.has("household") ? "New task assigned" : "Reminder assigned to you",
      body: record.title || "A task was assigned to you",
      url,
      tag: `assigned-${record.id}`,
    };
    const { sent, pruned } = await sendToUsers(admin, [newAssignee], payload);

    return Response.json({ ok: true, sent, pruned });
  } catch (err) {
    console.error("notify-task-assigned failed", err);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
});
