// HOUP-77: hero-item convergence, extracted from apps/web's
// app/home/hub-shared.tsx so apps/mobile can build the same "what's on
// today" feed from the same rules. No React, no browser globals — pure
// data derivation shared by both platforms' hero surfaces.

import type { HouseholdTask, Appointment, GoogleCalendarEventWithAttribution, GroupEvent } from './types';
import type { ModuleFeatureId } from './module-features';
import { taskOwnerModule, ownerScreenHref } from './task-modules';
import { parseReminderKey } from './reminders';
import { addDaysISO, daysBetweenISO, pad2 } from './date-utils';
import { DEFAULT_UPCOMING_WINDOW_DAYS } from './household-tasks';

/** Format a Date as a local YYYY-MM-DD (no UTC shift). */
export function localDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse a 'YYYY-MM-DD' string as a local-midnight Date (inverse of localDateISO). */
export function parseLocalISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export type HeroRange = 'today' | 'week' | 'month' | 'upcoming';

/**
 * Inclusive [from, to] window (both 'YYYY-MM-DD') for a hero range, anchored on
 * `today`. Week starts on Sunday, mirroring the calendar page's startOfWeek
 * convention. Month is the full calendar month containing today. Upcoming is
 * today through `upcomingDays` ahead (the user's tasks_upcoming_days, default 90).
 */
export function heroRangeWindow(
  today: string,
  range: HeroRange,
  upcomingDays: number = DEFAULT_UPCOMING_WINDOW_DAYS
): { from: string; to: string } {
  if (range === 'today') return { from: today, to: today };
  if (range === 'upcoming') return { from: today, to: addDaysISO(today, upcomingDays) };
  const base = parseLocalISODate(today);
  if (range === 'week') {
    const start = new Date(base);
    start.setDate(base.getDate() - base.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: localDateISO(start), to: localDateISO(end) };
  }
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { from: localDateISO(start), to: localDateISO(end) };
}

export type HeroItemType = 'task' | 'reminder' | 'appointment' | 'event' | 'calendar';

export interface HeroItem {
  id: string;
  type: HeroItemType;
  /** Which section owns this item — used for hiddenSections gating. */
  ownerSection: 'household' | 'search';
  title: string;
  dueDate: string | null; // YYYY-MM-DD
  dueTime: string | null; // HH:MM wall-clock
  overdue: boolean;
  done: boolean; // true = completed today, lingers until next day
  assignedTo: string | null;
  sourceLabel: string;
  /** When this to-do is backed by a dated checklist, its detail href. */
  checklistHref?: string | null;
  /** Live "done / total" of the backing checklist (dated checklists). */
  completionLabel?: string | null;
  /** Numeric done/total behind completionLabel, for the inline meter. */
  completionRatio?: { done: number; total: number } | null;
  /**
   * Modules: a bill or document reminder shown while Tasks isn't (task-modules.ts).
   * Tapping opens this screen instead of the task editor, and the row offers
   * no task actions beyond ticking it done.
   */
  opensAt?: string | null;
  task?: HouseholdTask; // present for task/reminder (mutable)
  appointment?: Appointment; // present for appointments (inert)
  googleEvent?: GoogleCalendarEventWithAttribution; // present for pulled calendar events (inert)
  groupEvent?: GroupEvent; // present for the household's own calendar events (inert, opens the calendar)
}

/**
 * Converge everything due within the selected range (defaults to today-or-earlier,
 * i.e. `range: 'today'`) into one typed list. Tasks & reminders come from the
 * household_tasks table (distinguished by template_key); appointments are only
 * included when Home Search is visible. Undated tasks/reminders always show,
 * regardless of range. Callers apply their own filters/sorting.
 */
export function buildHeroItems(opts: {
  tasks: HouseholdTask[];
  appointments: Appointment[];
  apartments: { id: string; address: string }[];
  today: string;
  householdVisible: boolean;
  searchVisible: boolean;
  /** task-id → checklist shortcut info, for dated-checklist to-dos. */
  checklistByTaskId?: Record<string, { href: string; completionLabel: string; completion: { done: number; total: number } }>;
  /** Pulled Google Calendar events (own + shared-by-group-members) — caller fetches the window, this filters to the selected range. */
  calendarEvents?: GoogleCalendarEventWithAttribution[];
  /** Independent toggle for surfacing pulled calendar events in the to-do feed. */
  showCalendarEventsInTodo?: boolean;
  /** Per-device dismissed gcal_event_ids — filtered out alongside the state==='dismissed' rows. */
  dismissedCalendarEventIds?: Set<string>;
  /** Which relative window to converge (defaults to 'today'). */
  range?: HeroRange;
  /** How many days ahead the 'upcoming' range reaches (upcomingWindowDays(userSettings)). Defaults to 90. */
  upcomingDays?: number;
  /** The household's own calendar events (Calendar's events, not Google's). */
  groupEvents?: GroupEvent[];
  /** Who's looking: someone else's private event never shows. */
  viewerId?: string | null;
  /** Modules: 'hub.events' (module-features.ts). False drops the household's events. Omitted counts as on. */
  groupEventsVisible?: boolean;
  /** Modules: 'hub.calendar-events' (module-features.ts). False drops pulled calendar events. Omitted counts as on. */
  calendarEventsVisible?: boolean;
  /** Modules: 'hub.task-checklists' (module-features.ts). False drops a task's checklist link, label and meter. Omitted counts as on. */
  taskChecklistsVisible?: boolean;
  /**
   * Modules: bill and document reminders belong to Costs and Documents
   * (task-modules.ts), so each shows while its owner is visible, whether or
   * not Tasks is. An owner left out follows householdVisible (every reminder
   * as a task, as before modules).
   */
  reminderOwnersVisible?: Partial<Record<'costs' | 'documents', boolean>>;
}): HeroItem[] {
  const { tasks, appointments, apartments, today, householdVisible, searchVisible } = opts;
  // Modules: checklist progress on a task needs household and checklists (module-features.ts).
  const checklistByTaskId = opts.taskChecklistsVisible === false ? {} : (opts.checklistByTaskId ?? {});
  // Modules: pulled calendar events need calendar (module-features.ts).
  const calendarEvents = opts.calendarEventsVisible === false ? [] : (opts.calendarEvents ?? []);
  const showCalendarEventsInTodo = opts.showCalendarEventsInTodo ?? true;
  const dismissedCalendarEventIds = opts.dismissedCalendarEventIds;
  const range = opts.range ?? 'today';
  const { from, to } = heroRangeWindow(today, range, opts.upcomingDays);
  const openItems: HeroItem[] = [];
  const doneItems: HeroItem[] = [];

  {
    for (const t of tasks) {
      if (t.deleted) continue;
      const owner = taskOwnerModule(t);
      const ownerVisible =
        owner === 'costs' || owner === 'documents'
          ? (opts.reminderOwnersVisible?.[owner] ?? householdVisible)
          : householdVisible;
      if (!ownerVisible) continue;
      if (t.done) {
        // Keep a completed task visible only if it was completed today.
        // Legacy done tasks (completed_at IS NULL) are intentionally hidden.
        if (!t.completed_at || localDateISO(new Date(t.completed_at)) < today) continue;
      } else {
        // Undated tasks always show; dated tasks show if due within the range
        // window OR already overdue (overdue always carries forward regardless
        // of range, so it never gets lost behind a Week/Month filter).
        if (t.due_date && t.due_date > to) continue;
      }
      const parsed = parseReminderKey(t.template_key);
      const isReminder = parsed !== null;
      // A to-do created for a dated checklist deep-links to the checklist and
      // shows its live completion, instead of the generic Tasks page.
      const checklistLink = t.linked_checklist_id ? checklistByTaskId[t.id] : undefined;
      const item: HeroItem = {
        id: t.id,
        type: isReminder ? 'reminder' : 'task',
        ownerSection: 'household',
        title: t.title,
        dueDate: t.due_date,
        dueTime: t.due_time,
        overdue: !t.done && !!t.due_date && t.due_date < today,
        done: t.done,
        assignedTo: t.assigned_to,
        sourceLabel: checklistLink ? 'Checklist' : isReminder ? 'Reminder' : t.template_key ? 'Moving' : 'Task',
        checklistHref: checklistLink?.href ?? null,
        completionLabel: checklistLink?.completionLabel ?? null,
        completionRatio: checklistLink?.completion ?? null,
        opensAt: householdVisible ? null : ownerScreenHref(owner),
        task: t,
      };
      if (t.done) {
        doneItems.push(item);
      } else {
        openItems.push(item);
      }
    }
  }

  const taskItems = [...openItems, ...doneItems];

  if (searchVisible) {
    for (const a of appointments) {
      if (a.status !== 'scheduled') continue;
      const when = new Date(a.scheduled_at);
      const whenISO = localDateISO(when);
      if (whenISO < from || whenISO > to) continue; // within the selected range window
      const address = apartments.find((ap) => ap.id === a.apartment_id)?.address;
      taskItems.push({
        id: a.id,
        type: 'appointment',
        ownerSection: 'search',
        title: address || a.notes || 'Viewing',
        dueDate: whenISO,
        dueTime: `${pad2(when.getHours())}:${pad2(when.getMinutes())}`,
        overdue: false, // events, not to-dos
        done: false,
        assignedTo: a.user_id,
        sourceLabel: 'Viewing',
        appointment: a,
      });
    }
  }

  // The household's events, by the day they start (an event under way from an
  // earlier day stays in the calendar, not the feed).
  if (opts.groupEventsVisible !== false) {
    for (const ev of opts.groupEvents ?? []) {
      if (ev.deleted) continue;
      if (ev.private && ev.created_by !== opts.viewerId) continue;
      const when = new Date(ev.starts_at);
      const eventDate = localDateISO(when);
      if (eventDate < from || eventDate > to) continue;
      taskItems.push({
        id: ev.id,
        type: 'event',
        ownerSection: 'household',
        title: ev.title,
        dueDate: eventDate,
        dueTime: ev.is_all_day ? null : `${pad2(when.getHours())}:${pad2(when.getMinutes())}`,
        overdue: false, // events, not to-dos
        done: false,
        assignedTo: ev.created_by,
        sourceLabel: ev.location?.trim() || 'Event',
        groupEvent: ev,
      });
    }
  }

  if (showCalendarEventsInTodo) {
    for (const ev of calendarEvents) {
      if (ev.state === 'dismissed') continue; // server-side dismissed rows never render
      if (dismissedCalendarEventIds?.has(ev.gcal_event_id)) continue; // per-device dismiss
      // All-day events are date-only (no time to lose) — slice directly,
      // instead of routing through new Date()/localDateISO which shifts
      // UTC-midnight into the wrong local day.
      const eventDate = ev.is_all_day ? ev.starts_at.slice(0, 10) : localDateISO(new Date(ev.starts_at));
      if (eventDate < from || eventDate > to) continue; // within the selected range window
      const when = ev.is_all_day ? null : new Date(ev.starts_at);
      taskItems.push({
        id: ev.id,
        type: 'calendar',
        ownerSection: 'search',
        title: ev.title || 'Event',
        dueDate: eventDate,
        dueTime: when ? `${pad2(when.getHours())}:${pad2(when.getMinutes())}` : null,
        overdue: false, // events, not to-dos
        done: false,
        assignedTo: ev.user_id,
        sourceLabel: ev.sharedByUserId ? 'Shared' : 'Calendar',
        googleEvent: ev,
      });
    }
  }

  return taskItems;
}

/**
 * Modules (module-features.ts): summary-hero modules that show another
 * module's data, by the frozen hero-module key both platforms' registries
 * share. While the feature is off the module is gone: not rendered and not in
 * the customize sheet, whatever the person's `home_hero_modules` says. The
 * saved toggle is left as is, so it comes back when the module does.
 * whosOnHook/unassignedNudge/streak only ever count tasks and reminders.
 */
export const HERO_MODULE_FEATURES: Readonly<Partial<Record<string, ModuleFeatureId>>> = {
  whosOnHook: 'hub.tasks',
  unassignedNudge: 'hub.tasks',
  streak: 'hub.tasks',
  budgetPulse: 'hub.budget',
  billsDue: 'hub.budget',
  shoppingList: 'hub.shopping',
  setupProgress: 'hub.setup-progress',
};

/** Whether a summary-hero module can show at all: it needs no feature, or its feature is on. */
export function isHeroModuleAvailable(key: string, feature: (id: ModuleFeatureId) => boolean): boolean {
  const id = HERO_MODULE_FEATURES[key];
  return id === undefined || feature(id);
}

const STREAK_LOOKBACK_DAYS = 60;

/**
 * Best-effort trailing streak of local days with >=1 completed task, from
 * `completed_at` on the current task rows. NOT a verified "everything due
 * that day was cleared" streak — there is no completion-history table:
 * `completed_at` lives only on currently-existing rows and is cleared on
 * un-check, recurring tasks renew (replacing the row), and deletes tombstone.
 * Ported verbatim from apps/web's hero-modules.tsx (HOUP-85) so both
 * platforms compute the identical number from the identical rule.
 */
export function computeAllClearStreak(tasks: HouseholdTask[], now: Date): number {
  const completedDays = new Set<string>();
  for (const t of tasks) {
    if (!t.completed_at) continue;
    completedDays.add(localDateISO(new Date(t.completed_at)));
  }
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
    if (!completedDays.has(localDateISO(cursor))) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** "today" / "tomorrow" / "in N days" from a whole-day count. Shared by billsDue and the countdown module. */
export function daysUntilLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/**
 * FLUX-258: whether and what the countdown tile shows for a pinned event.
 * `null` when nothing is pinned, either field is empty, or the date has
 * passed — a past date is not erased from storage, it just stops rendering.
 */
export function countdownDisplay(
  countdown: { label: string; date: string } | null,
  todayISO: string,
): { label: string; when: string } | null {
  if (!countdown || !countdown.label || !countdown.date) return null;
  const days = daysBetweenISO(todayISO, countdown.date);
  if (days < 0) return null;
  return { label: countdown.label, when: daysUntilLabel(days) };
}

/**
 * FLUX-258: shared trailing-debounce write gate for hero-module config rows
 * whose input fires on every keystroke/notch (unlike a discrete toggle's
 * immediate write). `isHolding()` is derived, never a counter — N calls to
 * `schedule` re-arm one timer but settle once, so a counter would never
 * return to zero.
 */
export function createWriteGate<T>(
  write: (value: T) => Promise<void>,
  opts: { delayMs?: number; onSettle?: () => void } = {},
): { schedule(value: T): void; flush(): Promise<void>; isHolding(): boolean; dispose(): void } {
  const delayMs = opts.delayMs ?? 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingValue: T | undefined;
  // Count of writes in flight, not a re-entrant flag — a write that outlives
  // the debounce (a slow upsert + refresh) must not let a second `schedule`
  // start a concurrent write; this returns to zero (one decrement per write's
  // `finally`), unlike the `schedule`-call counter this gate deliberately
  // avoids. `chain` serializes writes through Postgres in call order, same
  // shape as the `writeQueue` both hook callers already use for `setModule`.
  let inFlightCount = 0;
  let chain: Promise<void> = Promise.resolve();

  const runWrite = (value: T): Promise<void> => {
    inFlightCount += 1;
    // `chain.then(fn)` — not `chain.then(fn, onRejected)` — deliberately: an
    // onRejected here would run INSTEAD of `fn` whenever the previous link
    // rejected, so a failed write would silently stop every write after it
    // from ever calling `write()` again. Chain off `chain.catch()` so a
    // rejection never propagates into the next link, while `settled` (what
    // this call returns) still reflects this write's own outcome for
    // `schedule`'s `.catch()` and `flush`'s `await`.
    const settled = chain.catch(() => undefined).then(async () => {
      try {
        await write(value);
      } finally {
        inFlightCount -= 1;
        opts.onSettle?.();
      }
    });
    chain = settled.catch(() => undefined);
    return settled;
  };

  const schedule = (value: T): void => {
    pendingValue = value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const v = pendingValue as T;
      runWrite(v).catch(() => undefined);
    }, delayMs);
  };

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      await runWrite(pendingValue as T);
    }
  };

  return {
    schedule,
    flush,
    isHolding: () => timer !== null || inFlightCount > 0,
    dispose: () => {
      flush().catch(() => undefined);
    },
  };
}
