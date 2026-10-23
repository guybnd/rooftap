import { describe, expect, it } from 'vitest';
import type { Apartment, Appointment, GoogleCalendarEventWithAttribution, GroupEvent, HouseholdTask } from '../../types';
import type { BinCollection } from '../bins/bins';
import {
  CALENDAR_DEFAULT_HOUR,
  calendarAgenda,
  calendarDayCount,
  calendarDayHasItems,
  calendarOpenHour,
  filterApartments,
  formatClockTime,
  formatHourLabel,
  formatWallClock,
  heroDayLabel,
  isSameLocalDay,
  timedStartHours,
} from './calendar-view';
import { buildOccasion, type Occasion } from '../occasions/occasions';

// Local wall-clock instants, so the tests hold in any time zone.
const at = (day: number, hour = 0, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const day = (d: number) => new Date(2026, 9, d);

const appointment = (id: string, scheduled_at: string, extra: Partial<Appointment> = {}) =>
  ({ id, apartment_id: 'a1', scheduled_at, status: 'scheduled', ...extra }) as Appointment;
const event = (id: string, starts_at: string, extra: Partial<GroupEvent> = {}) =>
  ({ id, title: id, starts_at, ends_at: null, is_all_day: false, ...extra }) as GroupEvent;
const gcal = (id: string, starts_at: string, extra: Partial<GoogleCalendarEventWithAttribution> = {}) =>
  ({ id, title: id, starts_at, ends_at: null, is_all_day: false, ...extra }) as GoogleCalendarEventWithAttribution;
const task = (id: string, due_date: string | null, due_time: string | null = null) =>
  ({ id, title: id, due_date, due_time }) as HouseholdTask;
const apartment = (id: string, address: string, suburb: string | null = null) => ({ id, address, suburb }) as Apartment;

describe('day helpers', () => {
  it('matches the same local day only', () => {
    expect(isSameLocalDay(new Date(2026, 9, 23, 0, 1), new Date(2026, 9, 23, 23, 59))).toBe(true);
    expect(isSameLocalDay(new Date(2026, 9, 23), new Date(2026, 9, 24))).toBe(false);
  });

  it('formats clock times and hour labels', () => {
    expect(formatClockTime(new Date(2026, 9, 23, 16, 30))).toBe('4:30 PM');
    expect(formatWallClock('09:05')).toBe('9:05 AM');
    expect(formatHourLabel(0)).toBe('12 AM');
    expect(formatHourLabel(12)).toBe('12 PM');
    expect(formatHourLabel(15)).toBe('3 PM');
  });

  it('words the Hero day', () => {
    const now = new Date(2026, 9, 23, 10); // a Friday
    expect(heroDayLabel(day(23), now)).toBe('on today');
    expect(heroDayLabel(day(24), now)).toBe('on tomorrow');
    expect(heroDayLabel(day(22), now)).toBe('on yesterday');
    expect(heroDayLabel(day(27), now)).toBe('on Tuesday');
    expect(heroDayLabel(day(30), now)).toBe('on Oct 30');
    expect(heroDayLabel(day(20), now)).toBe('on Oct 20');
  });

  it('filters apartments by address or suburb', () => {
    const list = [apartment('1', '12 Smith St', 'Fitzroy'), apartment('2', '4 Oak Ave', null)];
    expect(filterApartments(list, '  ')).toBe(list);
    expect(filterApartments(list, 'fitz').map((a) => a.id)).toEqual(['1']);
    expect(filterApartments(list, 'OAK').map((a) => a.id)).toEqual(['2']);
  });
});

describe('calendarDayHasItems and calendarDayCount', () => {
  const sources = {
    appointments: [appointment('v', at(20, 10))],
    groupEvents: [event('trip', at(21, 9), { ends_at: at(23, 17) })],
    calendarEvents: [gcal('g', at(24, 8))],
    tasks: [task('t', '2026-10-25')],
  };

  it('sees every kind of item, a due to-do and a spanned event included', () => {
    expect(calendarDayHasItems(day(20), sources)).toBe(true);
    expect(calendarDayHasItems(day(22), sources)).toBe(true);
    expect(calendarDayHasItems(day(24), sources)).toBe(true);
    expect(calendarDayHasItems(day(25), sources)).toBe(true);
    expect(calendarDayHasItems(day(26), sources)).toBe(false);
  });

  it('counts viewings and events but not to-dos', () => {
    expect(calendarDayCount(day(22), sources)).toBe(1);
    expect(calendarDayCount(day(25), sources)).toBe(0);
    expect(calendarDayCount(day(20), { ...sources, calendarEvents: [gcal('g2', at(20, 12))] })).toBe(2);
  });
});

describe('calendarOpenHour', () => {
  const sources = {
    appointments: [appointment('v', at(20, 14))],
    groupEvents: [event('early', at(20, 11, 30)), event('all', at(20), { is_all_day: true })],
    calendarEvents: [gcal('allday', at(20), { is_all_day: true })],
  };

  it('opens an hour before now on today', () => {
    expect(calendarOpenHour([day(20)], sources, new Date(2026, 9, 20, 9, 30))).toBe(8.5);
    expect(calendarOpenHour([day(20)], sources, new Date(2026, 9, 20, 0, 15))).toBe(0);
  });

  it('opens half an hour before the first timed item, ignoring all-day ones', () => {
    expect(timedStartHours(day(20), sources)).toEqual([14, 11.5]);
    expect(calendarOpenHour([day(20)], sources, new Date(2026, 9, 1))).toBe(11);
  });

  it('opens the morning on an empty day, and looks across a week', () => {
    expect(calendarOpenHour([day(21)], sources, new Date(2026, 9, 1))).toBe(CALENDAR_DEFAULT_HOUR);
    expect(calendarOpenHour([day(19), day(20), day(21)], sources, new Date(2026, 9, 1))).toBe(11);
  });

  it('counts a spanned event only on its start day', () => {
    const span = { appointments: [], calendarEvents: [], groupEvents: [event('trip', at(19, 9), { ends_at: at(21, 9) })] };
    expect(timedStartHours(day(19), span)).toEqual([9]);
    expect(timedStartHours(day(20), span)).toEqual([]);
  });
});

describe('calendarAgenda', () => {
  const bins = { date: '2026-10-20', streams: [] } as unknown as BinCollection;

  it('adds occasions on the day as all-day rows, unless switched off', () => {
    const base: Occasion = buildOccasion({ id: 'o', groupId: 'g', title: '', kind: 'birthday', date: '1990-10-20', createdBy: null });
    const items = calendarAgenda(day(20), {
      appointments: [],
      apartments: [],
      groupEvents: [],
      calendarEvents: [],
      occasions: [
        { ...base, id: 'b', title: "Tegan's birthday", date: '1990-10-20' },
        { ...base, id: 'off', title: 'Hidden', date: '1990-10-20', on_calendar: false },
        { ...base, id: 'other', title: 'Later', date: '1990-10-21' },
      ],
    });
    expect(items.map((i) => [i.key, i.timeLabel])).toEqual([['occasion-b', 'All day']]);
  });

  it('merges a day and sorts it, all-day rows first', () => {
    const items = calendarAgenda(day(20), {
      appointments: [appointment('v', at(20, 14)), appointment('other', at(21, 9))],
      apartments: [apartment('a1', '12 Smith St')],
      groupEvents: [event('lunch', at(20, 12, 30)), event('trip', at(19, 9), { ends_at: at(21, 9) })],
      calendarEvents: [gcal('g', at(20, 9)), gcal('holiday', at(20), { is_all_day: true })],
      tasks: [task('bins out', '2026-10-20', '07:15'), task('call', '2026-10-20'), task('later', '2026-10-21')],
      binDay: bins,
    });
    expect(items.map((i) => i.key)).toEqual([
      'bins-2026-10-20',
      'gcal-holiday',
      'event-trip',
      'task-call',
      'task-bins out',
      'gcal-g',
      'event-lunch',
      'apt-v',
    ]);
    expect(items.map((i) => i.timeLabel)).toEqual(['All day', 'All day', 'All day', 'All day', '7:15 AM', '9:00 AM', '12:30 PM', '2:00 PM']);
    const viewing = items.find((i) => i.kind === 'appointment');
    expect(viewing && viewing.kind === 'appointment' && viewing.apartment?.address).toBe('12 Smith St');
  });

  it('gives a spanned event its clock time on its start day', () => {
    const items = calendarAgenda(day(19), {
      appointments: [],
      apartments: [],
      groupEvents: [event('trip', at(19, 9), { ends_at: at(21, 9) })],
      calendarEvents: [],
    });
    expect(items).toEqual([expect.objectContaining({ kind: 'event', sortMinutes: 540, timeLabel: '9:00 AM' })]);
  });
});
