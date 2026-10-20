import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_REMINDER_DAYS, EVENT_REMINDER_OPTIONS, eventReminderDays, toggleReminderDay } from './event-reminders';
// The notify-upcoming-events edge function's pure half.
import * as twin from '../../../supabase/functions/_shared/event-reminders';

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
    expect(Math.max(...EVENT_REMINDER_OPTIONS.map((o) => o.days))).toBe(twin.MAX_REMINDER_DAYS);
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

  it('leaves the time off an all-day event', () => {
    const ev = event('2026-10-19T13:00:00Z', { is_all_day: true });
    expect(twin.eventReminderPayload(ev, 0, MELB).body).toBe('Today');
  });
});
