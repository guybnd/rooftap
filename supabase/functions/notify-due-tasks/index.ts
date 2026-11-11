// FLUX-128 Phase 1: daily due-task reminders.
// Invoked once a day by pg_cron (see migration 20260614000014). Finds open tasks
// due today or tomorrow with an assignee, and pushes a reminder to that assignee's
// subscribed devices. No request body is needed.
//
// Modules (.docs/modules.md): a task notifies only while the module that owns
// it is on. A bill or document reminder belongs to Costs or Documents, so with
// Tasks off it still notifies and opens the bill or document side.
import { createAdmin, requireServiceRole, sendToUsers } from "../_shared/send-push.ts";
import { createModuleLookup } from "../_shared/modules.ts";
import { dueTaskPush, dueWindow, type DueTask } from "../_shared/notify-plans.ts";

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  try {
    const admin = createAdmin();
    const { today, tomorrow } = dueWindow(new Date());

    const { data: tasks, error } = await admin
      .from("household_tasks")
      .select("id, group_id, template_key, title, due_date, due_time, assigned_to, assignees")
      .eq("done", false)
      .not("assigned_to", "is", null)
      .gte("due_date", today)
      .lte("due_date", tomorrow);
    if (error) throw error;

    const dueTasks = (tasks ?? []) as DueTask[];
    if (dueTasks.length === 0) {
      return Response.json({ ok: true, tasks: 0, sent: 0, pruned: 0 });
    }

    // HOUP-154: routed through sendToUsers (web-push + native), per task since
    // each has its own body text.
    const modulesFor = createModuleLookup(admin);
    let sent = 0;
    let pruned = 0;
    let skipped = 0;
    for (const task of dueTasks) {
      const plan = dueTaskPush(task, today, await modulesFor(task.group_id));
      if (!plan) {
        skipped++;
        continue;
      }
      const result = await sendToUsers(admin, plan.to, plan.payload);
      sent += result.sent;
      pruned += result.pruned;
    }

    return Response.json({ ok: true, tasks: dueTasks.length, skipped, sent, pruned });
  } catch (err) {
    console.error("notify-due-tasks failed", err);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
});
