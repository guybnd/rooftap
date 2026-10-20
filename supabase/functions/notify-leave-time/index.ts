// "Time to leave" pushes for calendar events with a travel mode. Invoked every
// 5 minutes by pg_cron (migration 20261019070000). An event's travel time from
// home was worked out when it was saved (events.travel_minutes); each reader
// gets "Leave by 6:40pm" their own lead time before leaving (user_settings.
// leave_alert_minutes: 30 or 60, an hour by default), once per start time:
// event_leave_notices records whom it pushed for which start, so a moved event
// is pushed again.
//
// Readers are the same as reminders: a shared event's household, or only the
// creator of a private one. Modules: nothing is sent with Calendar off.
import { createAdmin, requireServiceRole, sendToUsers } from "../_shared/send-push.ts";
import { createModuleLookup } from "../_shared/modules.ts";
import { MAX_LEAVE_ALERT_MINUTES, leaveAlertMinutes, leavePushDue, leavePushPayload, type TravelEvent } from "../_shared/event-travel.ts";
import { localDateKey } from "../_shared/event-reminders.ts";

const FALLBACK_TIMEZONE = "Australia/Sydney";
/** The longest trip worth looking ahead for, plus the longest alert lead time. */
const MAX_LOOKAHEAD_HOURS = 7;

interface LeaveEvent extends TravelEvent {
  id: string;
  group_id: string;
  created_by: string | null;
  private: boolean;
}

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  try {
    const admin = createAdmin();
    const now = new Date();
    const { data, error } = await admin
      .from("events")
      .select("id, group_id, created_by, private, title, starts_at, location, travel_mode, travel_minutes")
      .eq("deleted", false)
      .not("travel_mode", "is", null)
      .gt("starts_at", now.toISOString())
      .lte("starts_at", new Date(now.getTime() + MAX_LOOKAHEAD_HOURS * 3_600_000).toISOString());
    if (error) throw error;
    // Anyone's earliest possible alert first: skip events nobody could be due for yet.
    const candidates = ((data ?? []) as LeaveEvent[]).filter((e) => leavePushDue(e, now, MAX_LEAVE_ALERT_MINUTES, null));
    if (candidates.length === 0) return Response.json({ ok: true, events: 0, sent: 0, pruned: 0 });

    const modulesFor = createModuleLookup(admin);
    let sent = 0;
    let pruned = 0;
    let events = 0;
    for (const event of candidates) {
      if (!(await modulesFor(event.group_id)).has("calendar")) continue;

      let readers: string[];
      if (event.private) {
        readers = event.created_by ? [event.created_by] : [];
      } else {
        const { data: rows, error: membersError } = await admin
          .from("group_members")
          .select("user_id")
          .eq("group_id", event.group_id);
        if (membersError) throw membersError;
        readers = (rows ?? []).map((r) => r.user_id as string);
      }
      if (readers.length === 0) continue;

      const [{ data: settings }, { data: notices, error: noticesError }] = await Promise.all([
        admin.from("user_settings").select("user_id, timezone, leave_alert_minutes").in("user_id", readers),
        admin.from("event_leave_notices").select("user_id, starts_at").eq("event_id", event.id),
      ]);
      if (noticesError) throw noticesError;
      const settingsOf = new Map((settings ?? []).map((s) => [s.user_id as string, s]));
      const sentFor = new Map((notices ?? []).map((n) => [n.user_id as string, n.starts_at as string]));

      const due = readers.filter((userId) =>
        leavePushDue(event, now, leaveAlertMinutes(settingsOf.get(userId)?.leave_alert_minutes as number | null), sentFor.get(userId) ?? null)
      );
      if (due.length === 0) continue;
      events += 1;

      // Record first: a failed send shouldn't make the next run push twice.
      const { error: markError } = await admin
        .from("event_leave_notices")
        .upsert(due.map((userId) => ({ event_id: event.id, user_id: userId, starts_at: event.starts_at, sent_at: now.toISOString() })), {
          onConflict: "event_id,user_id",
        });
      if (markError) throw markError;

      for (const userId of due) {
        const timeZone = (settingsOf.get(userId)?.timezone as string | null) ?? FALLBACK_TIMEZONE;
        const { title, body } = leavePushPayload(event, timeZone);
        const result = await sendToUsers(admin, [userId], {
          title,
          body,
          url: `/calendar?date=${localDateKey(new Date(event.starts_at), timeZone)}`,
          tag: `leave-${event.id}`,
        });
        sent += result.sent;
        pruned += result.pruned;
      }
    }
    return Response.json({ ok: true, events, sent, pruned });
  } catch (err) {
    console.error("notify-leave-time failed", err);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
});
