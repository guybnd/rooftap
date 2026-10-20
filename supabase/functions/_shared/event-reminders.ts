// Calendar event reminders: which reminder an event is due for today, and the
// push text. Pure and import-free so core's vitest suite can check it
// (packages/core/src/event-reminders.test.ts) next to core's own defaults.

/** Days before an event a reminder goes out when the event doesn't choose. */
export const DEFAULT_EVENT_REMINDER_DAYS = [7, 1];

/** The furthest-out reminder the event form offers (core's EVENT_REMINDER_OPTIONS). */
export const MAX_REMINDER_DAYS = 7;

export interface ReminderEvent {
  title: string;
  starts_at: string;
  is_all_day: boolean;
  location: string | null;
  reminder_days: number[] | null;
}

/** The event's chosen reminder days, or the defaults when it never chose. */
export function reminderDaysFor(event: Pick<ReminderEvent, "reminder_days">): number[] {
  return event.reminder_days ?? DEFAULT_EVENT_REMINDER_DAYS;
}

/** YYYY-MM-DD of an instant on the wall clock of `timeZone`. */
export function localDateKey(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function dayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * How many days before the event `now` is, on the reader's wall clock, when
 * that matches one of the event's reminder days; otherwise null. The daily run
 * calls this once per reader, so each reminder fires on exactly one run.
 */
export function dueReminderDays(event: ReminderEvent, now: Date, timeZone: string): number | null {
  const daysBefore =
    dayNumber(localDateKey(new Date(event.starts_at), timeZone)) - dayNumber(localDateKey(now, timeZone));
  return reminderDaysFor(event).includes(daysBefore) ? daysBefore : null;
}

function clock(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, hour: "numeric", minute: "2-digit", hour12: true })
    .format(instant)
    .replace(/\s/g, "")
    .toLowerCase();
}

/** "Mon 26 Oct", assembled from parts so ICU's punctuation can't vary it. */
function shortDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "short", day: "numeric", month: "short" })
    .formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

/** The push for a reminder `daysBefore` days ahead of the event. */
export function eventReminderPayload(
  event: ReminderEvent,
  daysBefore: number,
  timeZone: string,
): { title: string; body: string } {
  const start = new Date(event.starts_at);
  const when =
    daysBefore === 0
      ? "Today"
      : daysBefore === 1
        ? "Tomorrow"
        : shortDate(start, timeZone);
  const at = event.is_all_day ? "" : ` at ${clock(start, timeZone)}`;
  const where = event.location?.trim() ? `, ${event.location.trim()}` : "";
  return {
    title: daysBefore === 7 ? `Next week: ${event.title}` : event.title,
    body: `${when}${at}${where}`,
  };
}
