import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVENT_REMINDER_DAYS,
  EVENT_REMINDER_OPTIONS,
  MAX_EVENT_REMINDER_DAYS,
  addReminderDay,
  customReminderDays,
  eventReminderDays,
  parseReminderDays,
  reminderDayLabel,
  toggleReminderDay,
} from './event-reminders';
// The notify-upcoming-events edge function's pure half.
import * as twin from '../../../../../supabase/functions/_shared/event-reminders';

const MELB = 'Australia/Melbourne';

function event(starts_at: string, extra: Partial<twin.ReminderEvent> = {}): twin.ReminderEvent {
  return { title: 'Gig', starts_at, is_all_day: false, location: null, reminder_days: null, ...extra };
}

describe('event reminder days', () => {
  it('defaults to a week and a day before, the same on both sides', () => {
    expect(DEFAULT_EVENT_REMINDER_DAYS).toEqual([7, 1]);
    expect(twin.DEFAULT_EVENT_REMINDER_DAYS).toEqual(DEFAULT_EVENT_REMINDER_DAYS);
    expect(eventReminderDays({ reminder_days: null })).toEqual([7, 1]);
    expect(eventReminderDays({})).toEqual([7, 1]);
    expect(eventReminderDays({ reminder_days: [] })).toEqual([]);
  });

  it('never offers a reminder further out than the daily run looks', () => {
    expect(MAX_EVENT_REMINDER_DAYS).toBe(twin.MAX_REMINDER_DAYS);
    expect(Math.max(...EVENT_REMINDER_OPTIONS.map((o) => o.days))).toBeLessThanOrEqual(MAX_EVENT_REMINDER_DAYS);
    expect(parseReminderDays(String(MAX_EVENT_REMINDER_DAYS + 1))).toBeNull();
  });

  it('offers two and three days before', () => {
    expect(EVENT_REMINDER_OPTIONS.map((o) => o.days)).toEqual([7, 3, 2, 1, 0]);
  });

  it('labels any day, presets first', () => {
    expect(reminderDayLabel(2)).toBe('2 days before');
    expect(reminderDayLabel(7)).toBe('1 week before');
    expect(reminderDayLabel(14)).toBe('2 weeks before');
    expect(reminderDayLabel(5)).toBe('5 days before');
  });

  it('reads a typed number of days', () => {
    expect(parseReminderDays(' 5 ')).toBe(5);
    expect(parseReminderDays('0')).toBeNull();
    expect(parseReminderDays('2.5')).toBeNull();
    expect(parseReminderDays('')).toBeNull();
  });

  it('keeps custom days apart from the presets', () => {
    expect(customReminderDays([14, 7, 5, 1])).toEqual([14, 5]);
    expect(addReminderDay([7, 1], 5)).toEqual([7, 5, 1]);
    expect(addReminderDay([7, 5, 1], 5)).toEqual([7, 5, 1]);
  });

  it('toggles a day and keeps the list furthest first', () => {
    expect(toggleReminderDay([7, 1], 0)).toEqual([7, 1, 0]);
    expect(toggleReminderDay([1], 7)).toEqual([7, 1]);
    expect(toggleReminderDay([7, 1], 7)).toEqual([1]);
  });
});

describe('dueReminderDays', () => {
  // 22:00 UTC on 18 Oct is 9am on 19 Oct in Melbourne (AEDT), when the daily run fires.
  const run = new Date('2026-10-18T22:00:00Z');

  it('fires a week and a day before on the reader’s wall clock', () => {
    // 7:30pm 26 Oct Melbourne.
    expect(twin.dueReminderDays(event('2026-10-26T08:30:00Z'), run, MELB)).toBe(7);
    // 7:30pm 20 Oct Melbourne.
    expect(twin.dueReminderDays(event('2026-10-20T08:30:00Z'), run, MELB)).toBe(1);
  });

  it('stays quiet on other days and when reminders are off', () => {
    expect(twin.dueReminderDays(event('2026-10-23T08:30:00Z'), run, MELB)).toBeNull();
    expect(twin.dueReminderDays(event('2026-10-20T08:30:00Z', { reminder_days: [] }), run, MELB)).toBeNull();
  });

  it('counts an all-day event by its local date', () => {
    // Local midnight 20 Oct Melbourne is 13:00 UTC on 19 Oct.
    expect(twin.dueReminderDays(event('2026-10-19T13:00:00Z', { is_all_day: true }), run, MELB)).toBe(1);
  });

  it('fires a custom number of days before', () => {
    // 7:30pm 24 Oct Melbourne is 5 days after the run.
    expect(twin.dueReminderDays(event('2026-10-24T08:30:00Z', { reminder_days: [5] }), run, MELB)).toBe(5);
  });

  it('fires on the day when chosen', () => {
    expect(twin.dueReminderDays(event('2026-10-19T08:30:00Z', { reminder_days: [0] }), run, MELB)).toBe(0);
  });
});

describe('eventReminderPayload', () => {
  it('says when and where', () => {
    const ev = event('2026-10-20T08:30:00Z', { location: 'Queen Victoria Market' });
    expect(twin.eventReminderPayload(ev, 1, MELB)).toEqual({ title: 'Gig', body: 'Tomorrow at 7:30pm, Queen Victoria Market' });
  });

  it('names the date a week out', () => {
    const ev = event('2026-10-26T08:30:00Z');
    expect(twin.eventReminderPayload(ev, 7, MELB)).toEqual({ title: 'Next week: Gig', body: 'Mon 26 Oct at 7:30pm' });
  });

  it('counts the days for other reminders', () => {
    const ev = event('2026-10-22T08:30:00Z');
    expect(twin.eventReminderPayload(ev, 3, MELB)).toEqual({ title: 'In 3 days: Gig', body: 'Thu 22 Oct at 7:30pm' });
  });

  it('leaves the time off an all-day event', () => {
    const ev = event('2026-10-19T13:00:00Z', { is_all_day: true });
    expect(twin.eventReminderPayload(ev, 0, MELB).body).toBe('Today');
  });
});
