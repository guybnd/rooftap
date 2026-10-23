// Calendar event reminders (feedback: "1 week notice for all events and then
// day before"). An event's `reminder_days` lists how many days before it a
// push goes out; null means the defaults below. The daily
// notify-upcoming-events edge function sends them.

/** Days before an event a reminder goes out when the event doesn't choose. */
export const DEFAULT_EVENT_REMINDER_DAYS = [7, 1];

/** The reminder choices the event form offers, furthest first. */
export const EVENT_REMINDER_OPTIONS: { days: number; label: string }[] = [
  { days: 7, label: '1 week before' },
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
