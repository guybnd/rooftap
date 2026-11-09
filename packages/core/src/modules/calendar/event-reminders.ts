// Calendar event reminders (feedback: "1 week notice for all events and then
// day before"). An event's `reminder_days` lists how many days before it a
// push goes out; null means the defaults below. The daily
// notify-upcoming-events edge function sends them.

/** Days before an event a reminder goes out when the event doesn't choose. */
export const DEFAULT_EVENT_REMINDER_DAYS = [7, 1];

/**
 * The furthest-out reminder an event can choose. The daily run looks this far
 * ahead (supabase/functions/_shared/event-reminders.ts MAX_REMINDER_DAYS).
 */
export const MAX_EVENT_REMINDER_DAYS = 30;

/** The reminder choices the event form offers, furthest first. */
export const EVENT_REMINDER_OPTIONS: { days: number; label: string }[] = [
  { days: 7, label: '1 week before' },
  { days: 3, label: '3 days before' },
  { days: 2, label: '2 days before' },
  { days: 1, label: '1 day before' },
  { days: 0, label: 'On the day' },
];

/** The event's chosen reminder days, or the defaults when it never chose. */
export function eventReminderDays(event: { reminder_days?: number[] | null }): number[] {
  return event.reminder_days ?? DEFAULT_EVENT_REMINDER_DAYS;
}

/** Turn one reminder on or off, kept furthest first. */
export function toggleReminderDay(days: number[], day: number): number[] {
  const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
  return next.sort((a, b) => b - a);
}

/** "5 days before", "2 weeks before": the chip for any reminder day. */
export function reminderDayLabel(days: number): string {
  const preset = EVENT_REMINDER_OPTIONS.find((o) => o.days === days);
  if (preset) return preset.label;
  if (days % 7 === 0) return `${days / 7} weeks before`;
  return `${days} days before`;
}

/** Chosen days the preset chips don't show, furthest first: each gets its own chip. */
export function customReminderDays(days: number[]): number[] {
  return days.filter((d) => !EVENT_REMINDER_OPTIONS.some((o) => o.days === d)).sort((a, b) => b - a);
}

/** A typed "days before" for a custom reminder: a whole number from 1 to the max, else null. */
export function parseReminderDays(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days >= 1 && days <= MAX_EVENT_REMINDER_DAYS ? days : null;
}

/** Add a custom reminder day; one already on stays on. */
export function addReminderDay(days: number[], day: number): number[] {
  return days.includes(day) ? days : toggleReminderDay(days, day);
}
