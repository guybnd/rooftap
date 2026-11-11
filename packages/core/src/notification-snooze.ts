// Snooze buttons on phone notifications. A reminder push names the kind of
// thing it is about (`snooze` in its Expo message, as the category
// `snooze-<kind>`), and the phone registers one category per kind with the
// buttons that fit it. Tasks and event reminders use the person's own choices
// (Settings > Notifications); a "time to leave" alert and bin night use short
// fixed ones, because a day later is no use there.
//
// The Edge Functions keep the category names in
// supabase/functions/_shared/notification-snooze.ts; notification-snooze.test.ts checks
// the two agree.

export type SnoozeKind = 'task' | 'event' | 'leave' | 'bins';

export const SNOOZE_KINDS: readonly SnoozeKind[] = ['task', 'event', 'leave', 'bins'];

export interface SnoozeChoice {
  minutes: number;
  /** Settings label, "1 hour". */
  label: string;
  /** Button label on the notification, "1h". Kept short: Android fits three in a row. */
  short: string;
}

/** Every choice a person can put on their task and event notifications. */
export const SNOOZE_CHOICES: readonly SnoozeChoice[] = [
  { minutes: 15, label: '15 minutes', short: '15m' },
  { minutes: 30, label: '30 minutes', short: '30m' },
  { minutes: 60, label: '1 hour', short: '1h' },
  { minutes: 180, label: '3 hours', short: '3h' },
  { minutes: 1440, label: '1 day', short: '1d' },
  { minutes: 2880, label: '2 days', short: '2d' },
  { minutes: 10080, label: '1 week', short: '1w' },
];

/** Android shows at most three buttons on a notification. */
export const MAX_SNOOZE_BUTTONS = 3;

export const DEFAULT_SNOOZE_MINUTES: readonly number[] = [60, 1440, 10080];

/** Fixed buttons for the kinds where only a short wait makes sense. */
const FIXED_MINUTES: Partial<Record<SnoozeKind, readonly number[]>> = {
  leave: [5, 10, 15],
  bins: [30, 60, 120],
};

/** An event reminder never snoozes past this long before the event starts. */
export const EVENT_SNOOZE_LEAD_MINUTES = 60;

/** The soonest a snoozed notification comes back. */
const MIN_SNOOZE_MINUTES = 5;

const CATEGORY_PREFIX = 'snooze-';
const ACTION_PREFIX = 'snooze:';

export function snoozeCategoryId(kind: SnoozeKind): string {
  return `${CATEGORY_PREFIX}${kind}`;
}

export function snoozeKindFromCategory(categoryId: unknown): SnoozeKind | null {
  if (typeof categoryId !== 'string' || !categoryId.startsWith(CATEGORY_PREFIX)) return null;
  const kind = categoryId.slice(CATEGORY_PREFIX.length);
  return (SNOOZE_KINDS as readonly string[]).includes(kind) ? (kind as SnoozeKind) : null;
}

export function snoozeActionId(minutes: number): string {
  return `${ACTION_PREFIX}${minutes}`;
}

/** The minutes a snooze button stands for, or null for any other action (a plain tap). */
export function snoozeMinutesFromAction(actionId: unknown): number | null {
  if (typeof actionId !== 'string' || !actionId.startsWith(ACTION_PREFIX)) return null;
  const minutes = Number(actionId.slice(ACTION_PREFIX.length));
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

/** "1h", "45m", "1d", "1w" for any number of minutes. */
export function snoozeShortLabel(minutes: number): string {
  const known = SNOOZE_CHOICES.find((c) => c.minutes === minutes);
  if (known) return known.short;
  if (minutes % 10080 === 0) return `${minutes / 10080}w`;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/**
 * A stored pick, cleaned up: known choices only, no repeats, at most three,
 * shortest first. Anything unusable falls back to the defaults, so a
 * notification always has buttons.
 */
export function normalizeSnoozePick(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SNOOZE_MINUTES];
  const known = new Set(SNOOZE_CHOICES.map((c) => c.minutes));
  const picked = [...new Set(raw.filter((m): m is number => typeof m === 'number' && known.has(m)))]
    .sort((a, b) => a - b)
    .slice(0, MAX_SNOOZE_BUTTONS);
  return picked.length > 0 ? picked : [...DEFAULT_SNOOZE_MINUTES];
}

/** Turn one choice on or off. Keeps at least one and at most three. */
export function toggleSnoozePick(current: readonly number[], minutes: number): number[] {
  const pick = normalizeSnoozePick(current);
  if (pick.includes(minutes)) {
    return pick.length > 1 ? pick.filter((m) => m !== minutes) : pick;
  }
  if (pick.length >= MAX_SNOOZE_BUTTONS) return pick;
  return normalizeSnoozePick([...pick, minutes]);
}

/** The buttons a kind of notification shows, shortest first. */
export function snoozeMinutesFor(kind: SnoozeKind, pick: readonly number[]): number[] {
  return [...(FIXED_MINUTES[kind] ?? normalizeSnoozePick(pick))];
}

/**
 * When a snoozed notification comes back. An event reminder (anything sent
 * with the event's start) never comes back later than an hour before the
 * event, so "1 week" on a reminder the day before still reminds you in time.
 */
export function snoozeUntil(now: Date, minutes: number, startsAt?: string | null): Date {
  const target = now.getTime() + minutes * 60_000;
  const start = startsAt ? Date.parse(startsAt) : NaN;
  if (Number.isNaN(start)) return new Date(target);
  const latest = start - EVENT_SNOOZE_LEAD_MINUTES * 60_000;
  const soonest = now.getTime() + MIN_SNOOZE_MINUTES * 60_000;
  return new Date(Math.max(Math.min(target, latest), soonest));
}
