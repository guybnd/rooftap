// The event form's "how long" control (household feedback: "just pick start
// time and duration out of regular buckets with a button for custom"). The
// form keeps storing an end date and time; these helpers read and write it
// as a duration from the start so both apps' modals share one rule.
import type { EventFormFields } from './event-import';

export type EventTiming = Pick<EventFormFields, 'start_date' | 'start_time' | 'end_date' | 'end_time' | 'is_all_day'>;

export const EVENT_DURATION_OPTIONS = [
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '3h', minutes: 180 },
] as const;

/** What the duration row shows as picked: a bucket's minutes, all day, a custom end, or no end. */
export type EventDurationChoice = number | 'all-day' | 'custom' | null;

const pad2 = (n: number) => String(n).padStart(2, '0');

function localDate(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!d || !t) return null;
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function timeKey(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Minutes from start to end, or null when the event is all day or has no (valid) end. */
export function eventDurationMinutes(t: EventTiming): number | null {
  if (t.is_all_day || !t.end_date || !t.end_time) return null;
  const start = localDate(t.start_date, t.start_time);
  const end = localDate(t.end_date, t.end_time);
  if (!start || !end) return null;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return minutes > 0 ? minutes : null;
}

export function eventDurationChoice(t: EventTiming): EventDurationChoice {
  if (t.is_all_day) return 'all-day';
  if (!t.end_date || !t.end_time) return null;
  const minutes = eventDurationMinutes(t);
  return EVENT_DURATION_OPTIONS.some((o) => o.minutes === minutes) ? minutes : 'custom';
}

/** Sets the end `minutes` after the start; 'all-day' drops the times, null drops the end. */
export function withEventDuration<T extends EventTiming>(t: T, minutes: number | 'all-day' | null): T {
  if (minutes === 'all-day') return { ...t, is_all_day: true, end_date: '', end_time: '' };
  if (minutes === null) return { ...t, end_date: '', end_time: '' };
  const start = localDate(t.start_date, t.start_time || '09:00');
  if (!start) return t;
  const end = new Date(start.getTime() + minutes * 60000);
  return { ...t, is_all_day: false, start_time: t.start_time || '09:00', end_date: dateKey(end), end_time: timeKey(end) };
}

/** Moves the start and carries the end along, so the duration stays what was picked. */
export function withEventStart<T extends EventTiming>(t: T, start_date: string, start_time: string): T {
  const minutes = eventDurationMinutes(t);
  const next = { ...t, start_date, start_time };
  return minutes === null ? next : withEventDuration(next, minutes);
}

function clock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad2(d.getMinutes())}${d.getHours() < 12 ? 'am' : 'pm'}`;
}

/** "1h 30m", "45m", "2h". */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** The line under the duration row: "Ends 11:30am", or the day too when it ends on a later day. */
export function eventEndText(t: EventTiming): string | null {
  if (t.is_all_day) return 'All day';
  const minutes = eventDurationMinutes(t);
  if (minutes === null) return 'No end time';
  const end = localDate(t.end_date, t.end_time)!;
  const sameDay = t.end_date === t.start_date;
  const day = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][end.getDay()]} ${end.getDate()}`;
  return `Ends ${sameDay ? '' : `${day}, `}${clock(end)} (${durationText(minutes)})`;
}
