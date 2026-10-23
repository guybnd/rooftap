// Deno twin of packages/core/src/modules/calendar/event-travel.ts for notify-leave-time: when a
// "time to leave" push is due and what it says. Pure and import-free; core's
// event-travel.test.ts checks the two agree.

export const LEAVE_BUFFER_MINUTES = 10;

/** How long before leaving the push comes, by default (user_settings.leave_alert_minutes). */
export const DEFAULT_LEAVE_ALERT_MINUTES = 60;
const LEAVE_ALERT_MINUTES = [30, 60];
/** The earliest anyone's push can come. */
export const MAX_LEAVE_ALERT_MINUTES = Math.max(...LEAVE_ALERT_MINUTES);

/** The job runs every 5 minutes, so a push can go out up to this early. */
export const LEAVE_NOTICE_MINUTES = 5;

export function leaveAlertMinutes(value: number | null | undefined): number {
  return value != null && LEAVE_ALERT_MINUTES.includes(value) ? value : DEFAULT_LEAVE_ALERT_MINUTES;
}

export interface TravelEvent {
  title: string;
  starts_at: string;
  location: string | null;
  travel_mode: string | null;
  travel_minutes: number | null;
}

const MODE_WORDS: Record<string, string> = { drive: "by car", walk: "walking", cycle: "by bike" };

export function leaveAt(startsAt: string, travelMinutes: number): Date {
  return new Date(new Date(startsAt).getTime() - (travelMinutes + LEAVE_BUFFER_MINUTES) * 60_000);
}

export function travelText(minutes: number, mode: string): string {
  const m = Math.max(1, Math.round(minutes));
  const time = m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
  return `${time} ${MODE_WORDS[mode] ?? ""}`.trim();
}

/**
 * True when this run should push to someone: their alert time (`alertMinutes`
 * before leaving) is within the notice window, the event hasn't started, and
 * they weren't already pushed for this start time (`sentFor`, from
 * event_leave_notices).
 */
export function leavePushDue(event: TravelEvent, now: Date, alertMinutes: number, sentFor: string | null): boolean {
  if (!event.travel_mode || !event.travel_minutes || event.travel_minutes <= 0) return false;
  const start = new Date(event.starts_at);
  if (start.getTime() <= now.getTime()) return false;
  if (sentFor && new Date(sentFor).getTime() === start.getTime()) return false;
  const alertAt = leaveAt(event.starts_at, event.travel_minutes).getTime() - alertMinutes * 60_000;
  return alertAt <= now.getTime() + LEAVE_NOTICE_MINUTES * 60_000;
}

function clock(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, hour: "numeric", minute: "2-digit", hour12: true })
    .format(instant)
    .replace(/\s/g, "")
    .toLowerCase();
}

export function leavePushPayload(event: TravelEvent, timeZone: string): { title: string; body: string } {
  const leave = leaveAt(event.starts_at, event.travel_minutes ?? 0);
  const where = event.location?.trim() ? ` to ${event.location.trim()}` : "";
  return {
    title: `Leave by ${clock(leave, timeZone)} for ${event.title}`,
    body: `${travelText(event.travel_minutes ?? 0, event.travel_mode ?? "")}${where}, starts ${clock(new Date(event.starts_at), timeZone)}`,
  };
}
