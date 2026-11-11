// FLUX-128 Phase 2: "new comment" push.
// Invoked by a DB trigger (pg_net) on INSERT ON household_task_comments. Recipients
// are the parent task's assignee plus any prior commenters, excluding the author
// of this comment. Request body mirrors the Supabase Database Webhook shape:
//   { type: "INSERT", record: <new comment row> }
// Modules (.docs/modules.md): sent only while the module that owns the task is
// on (a bill or document reminder's is Costs or Documents).
import { createAdmin, requireServiceRole, sendToUsers } from "../_shared/send-push.ts";
import { createModuleLookup } from "../_shared/modules.ts";
import { taskCommentPush, type PushTask } from "../_shared/notify-plans.ts";

interface CommentRow {
  id: string;
  household_task_id: string;
  user_id: string;
  content: string;
}

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  try {
    const body = await req.json().catch(() => null);
    const record = body?.record as CommentRow | undefined;
    if (!record?.household_task_id) {
      return Response.json({ ok: true, skipped: true });
    }

    const admin = createAdmin();

    const { data: task } = await admin
      .from("household_tasks")
      .select("id, group_id, template_key, title, assigned_to, assignees")
      .eq("id", record.household_task_id)
      .single();
    if (!task) return Response.json({ ok: true, skipped: true });

    // Prior commenters on this task (so a back-and-forth notifies participants).
    const { data: commenters } = await admin
      .from("household_task_comments")
      .select("user_id")
      .eq("household_task_id", record.household_task_id);

    const plan = taskCommentPush(
      task as PushTask,
      record,
      (commenters ?? []).map((c) => c.user_id as string | null),
      await createModuleLookup(admin)(task.group_id),
    );
    if (!plan) return Response.json({ ok: true, sent: 0, pruned: 0 });
    const { sent, pruned } = await sendToUsers(admin, plan.to, plan.payload);

    return Response.json({ ok: true, sent, pruned });
  } catch (err) {
    console.error("notify-task-comment failed", err);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
});
