// Who gets which push, and what it says, for the notify-* Edge Functions. Each
// function loads rows and sends; the decisions live here as plain functions so
// core's vitest suite can check them (packages/core/src/notify-plans.test.ts).
// Imports only the other pure twins in _shared, never a URL or npm: package.
import { addedAssignees, assigneesOf, type AssigneeFields } from "./assignees.ts";
import { localDateKey } from "./event-reminders.ts";
import { leaveAlertMinutes, leavePushDue, leavePushPayload, type TravelEvent } from "./event-travel.ts";
import { addDaysISO, binNamesPhrase, binTurn, localDateTime } from "./bin-schedule.ts";
import { taskOpenHref } from "./module-rules.ts";
import { snoozeCategoryId, type SnoozeKind } from "./notification-snooze.ts";

/** The time zone for a reader or household that never set one. */
export const FALLBACK_TIMEZONE = "Australia/Sydney";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  // tag dedupes one logical notification across a user's devices.
  tag: string;
  // Snooze buttons on the phone: which kind of reminder this is. The phone
  // registers one notification category per kind
  // (packages/core/src/notification-snooze.ts). Left out, the push has no buttons.
  snooze?: SnoozeKind;
  // An event reminder's start, so a snooze never lands after the event.
  startsAt?: string;
}

/** One push and the people it goes to. */
export interface PushPlan {
  to: string[];
  payload: PushPayload;
}

/** `zone` when the runtime knows it, otherwise the fallback. */
export function zoneOrFallback(zone: string | null | undefined): string {
  if (!zone) return FALLBACK_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

// ---------------------------------------------------------------------------
// Tasks

export interface PushTask extends AssigneeFields {
  id: string;
  group_id: string;
  template_key: string | null;
  title: string;
}

export interface DueTask extends PushTask {
  due_date: string;
  due_time: string | null;
}

/** Today and tomorrow as UTC dates: the window the daily due-task run reads. */
export function dueWindow(now: Date): { today: string; tomorrow: string } {
  const at = (offset: number) => {
    const d = new Date(now.getTime());
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  return { today: at(0), tomorrow: at(1) };
}

/** Wall-clock "HH:MM[:SS]" as a compact 12 hour label (FLUX-144). */
export function formatTaskTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const period = h < 12 ? "am" : "pm";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${m[2]}${period}`;
}

/**
 * The reminder for a task due today or tomorrow: to everyone on it. Null when
 * the module that owns the task is off (a bill reminder with Costs off).
 */
export function dueTaskPush(task: DueTask, today: string, enabled: ReadonlySet<string>): PushPlan | null {
  const url = taskOpenHref(task, enabled);
  const to = assigneesOf(task);
  if (!url || to.length === 0) return null;
  const when = task.due_date === today ? "due today" : "due tomorrow";
  const at = task.due_time ? ` at ${formatTaskTime(task.due_time)}` : "";
  return {
    to,
    payload: {
      title: enabled.has("household") ? "Task reminder" : "Reminder",
      body: `${task.title} is ${when}${at}`,
      url,
      tag: `due-${task.id}`,
      snooze: "task",
    },
  };
}

/** "Assigned to you": only to the people newly on the task. */
export function assignedTaskPush(
  task: PushTask,
  before: AssigneeFields | null | undefined,
  enabled: ReadonlySet<string>,
): PushPlan | null {
  const to = addedAssignees(before, task);
  const url = taskOpenHref(task, enabled);
  if (!url || to.length === 0) return null;
  return {
    to,
    payload: {
      title: enabled.has("household") ? "New task assigned" : "Reminder assigned to you",
      body: task.title || "A task was assigned to you",
      url,
      tag: `assigned-${task.id}`,
      snooze: "task",
    },
  };
}

/** A comment cut to `max` characters, with an ellipsis when cut. */
export function commentSnippet(text: string | null | undefined, max = 80): string {
  const t = (text ?? "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * "New comment": to everyone on the task and everyone who commented before,
 * never to the person who wrote it.
 */
export function taskCommentPush(
  task: PushTask,
  comment: { user_id: string; content: string },
  priorCommenters: readonly (string | null)[],
  enabled: ReadonlySet<string>,
): PushPlan | null {
  const url = taskOpenHref(task, enabled);
  if (!url) return null;
  const to = new Set<string>(assigneesOf(task));
  for (const id of priorCommenters) if (id) to.add(id);
  to.delete(comment.user_id);
  if (to.size === 0) return null;
  return {
    to: [...to],
    payload: {
      title: `New comment: ${task.title}`,
      body: commentSnippet(comment.content),
      url,
      tag: `comment-${task.id}`,
      snooze: "task",
    },
  };
}

// ---------------------------------------------------------------------------
// Calendar

export interface ReaderEvent {
  created_by: string | null;
  private: boolean;
}

/** Who an event's pushes go to: its household, or only the person who made a private one. */
export function eventReaders(event: ReaderEvent, members: readonly string[]): string[] {
  if (event.private) return event.created_by ? [event.created_by] : [];
  return [...new Set(members)];
}

/** The calendar day an event opens on, on the reader's wall clock. */
export function calendarHref(startsAt: string, timeZone: string): string {
  return `/calendar?date=${localDateKey(new Date(startsAt), timeZone)}`;
}

/** An event reminder, with the forecast at home added when there is one. */
export function eventReminderPush(
  event: { id: string; starts_at: string },
  daysBefore: number,
  timeZone: string,
  text: { title: string; body: string },
  forecast: string | null,
): PushPayload {
  return {
    title: text.title,
    body: forecast ? `${text.body}. ${forecast[0].toUpperCase()}${forecast.slice(1)}` : text.body,
    url: calendarHref(event.starts_at, timeZone),
    tag: `event-${event.id}-${daysBefore}`,
    snooze: "event",
    startsAt: event.starts_at,
  };
}

export interface LeaveEvent extends TravelEvent, ReaderEvent {
  id: string;
}

export interface LeaveSettings {
  timezone?: string | null;
  leave_alert_minutes?: number | null;
}

/**
 * The readers due a "Leave by" push on this run, each with their own lead
 * time, skipping anyone already pushed for this start time.
 */
export function leaveDueReaders(
  event: LeaveEvent,
  readers: readonly string[],
  settingsOf: ReadonlyMap<string, LeaveSettings>,
  sentFor: ReadonlyMap<string, string>,
  now: Date,
): string[] {
  return readers.filter((userId) =>
    leavePushDue(event, now, leaveAlertMinutes(settingsOf.get(userId)?.leave_alert_minutes), sentFor.get(userId) ?? null)
  );
}

/** The "Leave by" push for one reader, in their time zone. */
export function leavePush(event: LeaveEvent, settings: LeaveSettings | undefined): PushPayload {
  const timeZone = zoneOrFallback(settings?.timezone);
  const { title, body } = leavePushPayload(event, timeZone);
  return { title, body, url: calendarHref(event.starts_at, timeZone), tag: `leave-${event.id}`, snooze: "leave" };
}

// ---------------------------------------------------------------------------
// Bin night

export interface BinPlanRow {
  group_id: string;
  push_at: string | null;
  rotation: string[] | null;
  rotation_anchor: string | null;
  out_for: string | null;
  timezone: string | null;
}

/**
 * The collection date this run should push for: tomorrow in the plan's time
 * zone, once its push time has passed tonight and the bins aren't marked out.
 * Null when it isn't time yet, or the bins are already out.
 */
export function binNightCollection(plan: BinPlanRow, now: Date): string | null {
  if (!plan.push_at) return null;
  const local = localDateTime(now, zoneOrFallback(plan.timezone));
  if (local.time < plan.push_at) return null;
  const collection = addDaysISO(local.date, 1);
  return plan.out_for === collection ? null : collection;
}

/** Whoever's turn it is, or the whole household with no rotation. */
export function binNightReaders(plan: BinPlanRow, collection: string, members: readonly string[]): string[] {
  const turn = binTurn(plan.rotation ?? [], plan.rotation_anchor, collection);
  return turn ? [turn] : [...new Set(members)];
}

export function binNightPush(groupId: string, collection: string, bins: readonly { name: string }[]): PushPayload {
  return {
    title: "Bins out tonight",
    body: `${binNamesPhrase(bins)}, collected tomorrow morning.`,
    url: "/bins",
    tag: `bins-${groupId}-${collection}`,
    snooze: "bins",
  };
}

// ---------------------------------------------------------------------------
// Delivery

/** One Expo push message: the phone reads `data.url` on a tap and `categoryId` for snooze buttons. */
export function expoMessage(token: string, payload: PushPayload) {
  return {
    to: token,
    title: payload.title,
    body: payload.body,
    data: { url: payload.url, ...(payload.startsAt ? { startsAt: payload.startsAt } : {}) },
    ...(payload.snooze ? { categoryId: snoozeCategoryId(payload.snooze) } : {}),
  };
}

export interface ExpoPushTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

/**
 * Reads Expo's tickets for one chunk of tokens, in order: how many went out,
 * which tokens to prune (DeviceNotRegistered), and the other failures.
 */
export function readExpoTickets(
  tokens: readonly string[],
  tickets: readonly ExpoPushTicket[],
): { sent: number; stale: string[]; failed: ExpoPushTicket[] } {
  let sent = 0;
  const stale: string[] = [];
  const failed: ExpoPushTicket[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket.status === "ok") sent++;
    else if (ticket.details?.error === "DeviceNotRegistered" && tokens[i]) stale.push(tokens[i]);
    else failed.push(ticket);
  });
  return { sent, stale, failed };
}

/** Web push status codes that mean the subscription is gone and should be pruned. */
export function isStaleWebPushStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}
