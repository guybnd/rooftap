// The calendar screen's view logic, shared by web's calendar page and the
// phone's Calendar tab: day matching, the Hero's words, where the hour grid
// opens, the presence dot, the lede count and one day's agenda. Each app keeps
// its own rendering and maps the agenda items onto its own rows.
import type {
  Apartment,
  Appointment,
  GoogleCalendarEventWithAttribution,
  GroupEvent,
  HouseholdTask,
} from '../../types';
import type { BinCollection } from '../bins/bins';
import { occasionsOnDay, type Occasion } from '../occasions/occasions';
import { daysBetweenISO, toISODate } from '../../date-utils';
import { getEventsForDay, isEventStartDay } from './calendar-overlap';

/** Same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "4:30 PM". */
export function formatClockTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** A wall-clock "HH:MM" (a task's due time) as "4:30 PM". */
export function formatWallClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return formatClockTime(new Date(1970, 0, 1, h, m));
}

/** The hour grid's gutter label: "9 AM". */
export function formatHourLabel(hour: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h} ${ampm}`;
}

/** H6: the Hero's day in words. Today / tomorrow / a weekday inside the coming week, then "Oct 25". */
export function heroDayLabel(day: Date, now: Date = new Date()): string {
  const diff = daysBetweenISO(toISODate(now), toISODate(day));
  if (diff === 0) return 'on today';
  if (diff === 1) return 'on tomorrow';
  if (diff === -1) return 'on yesterday';
  if (diff > 1 && diff < 7) return `on ${day.toLocaleDateString('en-US', { weekday: 'long' })}`;
  return `on ${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/** The apartment picker's search: address or suburb, any case. A blank query keeps them all. */
export function filterApartments(apartments: Apartment[], query: string): Apartment[] {
  if (!query.trim()) return apartments;
  const q = query.toLowerCase();
  return apartments.filter((a) => a.address.toLowerCase().includes(q) || (a.suburb && a.suburb.toLowerCase().includes(q)));
}

/** What a calendar day can hold. */
export interface CalendarDaySources {
  appointments: Appointment[];
  groupEvents: GroupEvent[];
  /** Pulled Google events. Pass none while Google Calendar isn't connected. */
  calendarEvents: GoogleCalendarEventWithAttribution[];
  tasks?: HouseholdTask[];
}

function appointmentsOn(appointments: Appointment[], date: Date): Appointment[] {
  return appointments.filter((a) => isSameLocalDay(new Date(a.scheduled_at), date));
}

// Google events never span days the way household events can, so they match on their start day.
function calendarEventsOn(events: GoogleCalendarEventWithAttribution[], date: Date): GoogleCalendarEventWithAttribution[] {
  return events.filter((ev) => isSameLocalDay(new Date(ev.starts_at), date));
}

/** The week strip's presence dot: does the day hold anything at all, a due to-do included? */
export function calendarDayHasItems(date: Date, sources: CalendarDaySources): boolean {
  if (appointmentsOn(sources.appointments, date).length > 0) return true;
  if (calendarEventsOn(sources.calendarEvents, date).length > 0) return true;
  if (getEventsForDay(sources.groupEvents, date).length > 0) return true;
  const key = toISODate(date);
  return (sources.tasks ?? []).some((t) => t.due_date === key);
}

/** The Hero's count for a day: viewings, household events and Google events (to-dos aren't counted). */
export function calendarDayCount(date: Date, sources: CalendarDaySources): number {
  return (
    appointmentsOn(sources.appointments, date).length +
    getEventsForDay(sources.groupEvents, date).length +
    calendarEventsOn(sources.calendarEvents, date).length
  );
}

const hourOf = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
};

/** Start hours (fractional) of the day's timed items. A spanned event counts only on its start day. */
export function timedStartHours(date: Date, sources: CalendarDaySources): number[] {
  return [
    ...appointmentsOn(sources.appointments, date).map((a) => hourOf(a.scheduled_at)),
    ...calendarEventsOn(sources.calendarEvents, date)
      .filter((ev) => !ev.is_all_day)
      .map((ev) => hourOf(ev.starts_at)),
    ...getEventsForDay(sources.groupEvents, date)
      .filter((ev) => !ev.is_all_day && isEventStartDay(ev, date))
      .map((ev) => hourOf(ev.starts_at)),
  ];
}

/** First hour an empty day or week opens on. */
export const CALENDAR_DEFAULT_HOUR = 8;

/**
 * The hour an hour grid of these days opens on: an hour before now when it
 * holds today, else half an hour before its first timed item, else the
 * morning. Never before midnight.
 */
export function calendarOpenHour(days: Date[], sources: CalendarDaySources, now: Date = new Date()): number {
  if (days.some((d) => isSameLocalDay(d, now))) return Math.max(0, now.getHours() + now.getMinutes() / 60 - 1);
  const starts = days.flatMap((d) => timedStartHours(d, sources));
  return starts.length > 0 ? Math.max(0, Math.min(...starts) - 0.5) : CALENDAR_DEFAULT_HOUR;
}

/** One agenda row's data. `sortMinutes` is -1 for an all-day row, so those lead. */
export type CalendarAgendaItem =
  | { kind: 'appointment'; key: string; sortMinutes: number; timeLabel: string; appointment: Appointment; apartment: Apartment | null }
  | { kind: 'event'; key: string; sortMinutes: number; timeLabel: string; event: GroupEvent }
  | { kind: 'calendarEvent'; key: string; sortMinutes: number; timeLabel: string; calendarEvent: GoogleCalendarEventWithAttribution }
  | { kind: 'task'; key: string; sortMinutes: number; timeLabel: string; task: HouseholdTask }
  | { kind: 'bins'; key: string; sortMinutes: number; timeLabel: string; collection: BinCollection }
  | { kind: 'occasion'; key: string; sortMinutes: number; timeLabel: string; occasion: Occasion };

/** A day's agenda sources, plus the apartments viewings name, the day's bin collection and the household's occasions. */
export interface CalendarAgendaSources extends CalendarDaySources {
  apartments: Apartment[];
  binDay?: BinCollection | null;
  /** Every occasion (calendar.occasions); those falling on the day and shown on the Calendar become rows. */
  occasions?: Occasion[];
}

const ALL_DAY = 'All day';

/**
 * One day's agenda: viewings, Google events, household events, the bin
 * collection, birthdays and other occasions, and to-dos due that day, sorted by time (all-day rows first, in
 * that order otherwise). A later day of a spanned event is an all-day row,
 * since only its start day carries a clock time.
 */
export function calendarAgenda(date: Date, sources: CalendarAgendaSources): CalendarAgendaItem[] {
  const items: CalendarAgendaItem[] = [];
  const dateKey = toISODate(date);
  const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

  if (sources.binDay) {
    items.push({ kind: 'bins', key: `bins-${sources.binDay.date}`, sortMinutes: -1, timeLabel: ALL_DAY, collection: sources.binDay });
  }

  occasionsOnDay(sources.occasions ?? [], dateKey).forEach((occasion) => {
    items.push({ kind: 'occasion', key: `occasion-${occasion.id}`, sortMinutes: -1, timeLabel: ALL_DAY, occasion });
  });

  appointmentsOn(sources.appointments, date).forEach((app) => {
    const d = new Date(app.scheduled_at);
    items.push({
      kind: 'appointment',
      key: `apt-${app.id}`,
      sortMinutes: minutesOf(d),
      timeLabel: formatClockTime(d),
      appointment: app,
      apartment: sources.apartments.find((a) => a.id === app.apartment_id) ?? null,
    });
  });

  calendarEventsOn(sources.calendarEvents, date).forEach((ev) => {
    const d = new Date(ev.starts_at);
    items.push({
      kind: 'calendarEvent',
      key: `gcal-${ev.id}`,
      sortMinutes: ev.is_all_day ? -1 : minutesOf(d),
      timeLabel: ev.is_all_day ? ALL_DAY : formatClockTime(d),
      calendarEvent: ev,
    });
  });

  getEventsForDay(sources.groupEvents, date).forEach((ev) => {
    const allDay = ev.is_all_day || !isEventStartDay(ev, date);
    const d = new Date(ev.starts_at);
    items.push({
      kind: 'event',
      key: `event-${ev.id}`,
      sortMinutes: allDay ? -1 : minutesOf(d),
      timeLabel: allDay ? ALL_DAY : formatClockTime(d),
      event: ev,
    });
  });

  (sources.tasks ?? [])
    .filter((t) => t.due_date === dateKey)
    .forEach((t) => {
      const [h, m] = t.due_time ? t.due_time.split(':').map(Number) : [null, null];
      items.push({
        kind: 'task',
        key: `task-${t.id}`,
        sortMinutes: h === null ? -1 : h * 60 + (m ?? 0),
        timeLabel: t.due_time ? formatWallClock(t.due_time) : ALL_DAY,
        task: t,
      });
    });

  return items.sort((a, b) => a.sortMinutes - b.sortMinutes);
}
