// Daily calendar event reminders: by default a week before and the day before
// every event, or whichever days the event chose (`events.reminder_days`).
// Invoked once a day by pg_cron (migration 20261019050000), at the same time as
// notify-due-tasks. No request body is needed.
//
// A shared event reminds every member of its household; a private one only the
// person who made it. Each reader's own timezone (user_settings.timezone)
// decides which day "a week before" is, so each reminder fires on one run.
//
// Modules (.docs/modules.md): nothing is sent for a household with Calendar off.
import {
  createAdmin,
  requireServiceRole,
  sendToUsers,
} from "../_shared/send-push.ts";
import { createModuleLookup } from "../_shared/modules.ts";
import {
  dueReminderDays,
  MAX_REMINDER_DAYS,
  eventReminderPayload,
  localDateKey,
  type ReminderEvent,
} from "../_shared/event-reminders.ts";
import { eventForecastTextFrom, openMeteoEventForecastUrl } from "../_shared/event-forecast.ts";

const FALLBACK_TIMEZONE = "Australia/Sydney";

/** The event's start hour (0 to 23) on `timeZone`'s wall clock. */
function localHour(instant: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-AU", { timeZone, hour: "numeric", hourCycle: "h23" }).format(instant));
}

interface UpcomingEvent extends ReminderEvent {
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
    // The furthest reminder the form offers is a week out; a day either side
    // covers every reader's timezone.
    const from = new Date(now.getTime() - 86_400_000);
    const to = new Date(now.getTime() + (MAX_REMINDER_DAYS + 2) * 86_400_000);

    const { data, error } = await admin
      .from("events")
      .select("id, group_id, created_by, private, title, starts_at, is_all_day, location, reminder_days")
      .eq("deleted", false)
      .gte("starts_at", from.toISOString())
      .lte("starts_at", to.toISOString());
    if (error) throw error;
    const events = (data ?? []) as UpcomingEvent[];
    if (events.length === 0) return Response.json({ ok: true, events: 0, sent: 0, pruned: 0 });

    const modulesFor = createModuleLookup(admin);
    const membersByGroup = new Map<string, string[]>();
    const timezoneByUser = new Map<string, string>();

    const readers = async (event: UpcomingEvent): Promise<string[]> => {
      if (event.private) return event.created_by ? [event.created_by] : [];
      let members = membersByGroup.get(event.group_id);
      if (!members) {
        const { data: rows, error: membersError } = await admin
          .from("group_members")
          .select("user_id")
          .eq("group_id", event.group_id);
        if (membersError) throw membersError;
        members = (rows ?? []).map((r) => r.user_id as string);
        membersByGroup.set(event.group_id, members);
      }
      return members;
    };

    const timezoneOf = async (userId: string): Promise<string> => {
      const cached = timezoneByUser.get(userId);
      if (cached) return cached;
      const { data: settings } = await admin
        .from("user_settings")
        .select("timezone")
        .eq("user_id", userId)
        .maybeSingle();
      const tz = (settings?.timezone as string | undefined) ?? FALLBACK_TIMEZONE;
      timezoneByUser.set(userId, tz);
      return tz;
    };

    // The forecast at the household's home: the event's place isn't geocoded
    // here, and for weather a city's worth of distance hardly matters.
    const homeByGroup = new Map<string, { lat: number; lng: number } | null>();
    const homeOf = async (groupId: string) => {
      if (homeByGroup.has(groupId)) return homeByGroup.get(groupId) ?? null;
      const { data: g } = await admin.from("groups").select("home_lat, home_lng").eq("id", groupId).maybeSingle();
      const home = g?.home_lat != null && g?.home_lng != null ? { lat: Number(g.home_lat), lng: Number(g.home_lng) } : null;
      homeByGroup.set(groupId, home);
      return home;
    };
    const forecasts = new Map<string, Promise<unknown>>();
    const forecastFor = async (event: UpcomingEvent, timeZone: string): Promise<string | null> => {
      const home = await homeOf(event.group_id);
      if (!home) return null;
      const start = new Date(event.starts_at);
      const date = localDateKey(start, timeZone);
      const key = `${event.group_id}:${date}`;
      let raw = forecasts.get(key);
      if (!raw) {
        raw = fetch(openMeteoEventForecastUrl(home.lat, home.lng, date), { signal: AbortSignal.timeout(5000) })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);
        forecasts.set(key, raw);
      }
      return eventForecastTextFrom(await raw, event.is_all_day ? null : localHour(start, timeZone));
    };

    let sent = 0;
    let pruned = 0;
    let skipped = 0;
    for (const event of events) {
      if (!(await modulesFor(event.group_id)).has("calendar")) {
        skipped++;
        continue;
      }
      for (const userId of await readers(event)) {
        const timeZone = await timezoneOf(userId);
        const daysBefore = dueReminderDays(event, now, timeZone);
        if (daysBefore === null) continue;
        const { title, body } = eventReminderPayload(event, daysBefore, timeZone);
        const forecast = await forecastFor(event, timeZone);
        const result = await sendToUsers(admin, [userId], {
          title,
          body: forecast ? `${body}. ${forecast[0].toUpperCase()}${forecast.slice(1)}` : body,
          url: `/calendar?date=${localDateKey(new Date(event.starts_at), timeZone)}`,
          tag: `event-${event.id}-${daysBefore}`,
        });
        sent += result.sent;
        pruned += result.pruned;
      }
    }

    return Response.json({ ok: true, events: events.length, skipped, sent, pruned });
  } catch (err) {
    console.error("notify-upcoming-events failed", err);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
});
