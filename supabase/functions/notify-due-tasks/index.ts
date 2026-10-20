// FLUX-128 Phase 1: daily due-task reminders.
// Invoked once a day by pg_cron (see migration 20260614000014). Finds open tasks
// due today or tomorrow with an assignee, and pushes a reminder to that assignee's
// subscribed devices. No request body is needed.
//
// Modules (.docs/modules.md): a task notifies only while the module that owns
// it is on. A bill or document reminder belongs to Costs or Documents, so with
// Tasks off it still notifies and opens the bill or document side.
import {
  createAdmin,
  requireServiceRole,
  sendToUsers,
  type PushPayload,
} from "../_shared/send-push.ts";
import { createModuleLookup, taskOpenHref } from "../_shared/modules.ts";

interface DueTask {
  id: string;
  group_id: string;
  template_key: string | null;
  title: string;
  due_date: string;
  due_time: string | null;
  assigned_to: string;
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Wall-clock "HH:MM[:SS]" → compact 12h label for the reminder body (FLUX-144).
function formatTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const period = h < 12 ? "am" : "pm";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${m[2]}${period}`;
}

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  try {
    const admin = createAdmin();
    const today = isoDate(0);
    const tomorrow = isoDate(1);

    const { data: tasks, error } = await admin
      .from("household_tasks")
      .select("id, group_id, template_key, title, due_date, due_time, assigned_to")
      .eq("done", false)
      .not("assigned_to", "is", null)
      .gte("due_date", today)
      .lte("due_date", tomorrow);
    if (error) throw error;

    const dueTasks = (tasks ?? []) as DueTask[];
    if (dueTasks.length === 0) {
      return Response.json({ ok: true, tasks: 0, sent: 0, pruned: 0 });
    }

    // HOUP-154: routed through sendToUsers (web-push + native) instead of an
    // inline web-push-only loop, per task since each has its own body text.
    const modulesFor = createModuleLookup(admin);
    let sent = 0;
    let pruned = 0;
    let skipped = 0;
    for (const task of dueTasks) {
      const enabled = await modulesFor(task.group_id);
      const url = taskOpenHref(task, enabled);
      if (!url) {
        skipped++;
        continue;
      }
      const when = task.due_date === today ? "due today" : "due tomorrow";
      const at = task.due_time ? ` at ${formatTime(task.due_time)}` : "";
      const payload: PushPayload = {
        title: enabled.has("household") ? "Task reminder" : "Reminder",
        body: `${task.title} is ${when}${at}`,
        url,
        tag: `due-${task.id}`,
      };
      const result = await sendToUsers(admin, [task.assigned_to], payload);
      sent += result.sent;
      pruned += result.pruned;
    }

    return Response.json({ ok: true, tasks: dueTasks.length, skipped, sent, pruned });
  } catch (err) {
    console.error("notify-due-tasks failed", err);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
});
