import { describe, expect, it } from 'vitest';
import type { GroupEvent } from '../../types';
import { localDateTimeToISO, todayISO } from '../../date-utils';
import { eventFromForm, initialEventForm, type EventForm } from './event-form';

const saved = {
  id: 'e1',
  group_id: 'g1',
  created_by: 'u1',
  title: 'Concert',
  category: 'social',
  starts_at: localDateTimeToISO('2026-10-30', '19:30'),
  ends_at: localDateTimeToISO('2026-10-30', '22:00'),
  is_all_day: false,
  location: 'Forum',
  notes: 'Row F',
  private: true,
  reminder_days: [1],
  travel_mode: 'walk',
  travel_minutes: 12,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  deleted: false,
} as GroupEvent;

const ctx = { event: null, groupId: 'g1', newId: 'new-1', showBudget: true, travelMinutes: 20 };

describe('initialEventForm', () => {
  it('opens an event with its own values', () => {
    expect(initialEventForm(saved, { costCents: 4550, hasHome: true })).toEqual({
      title: 'Concert',
      category: 'social',
      private: true,
      start_date: '2026-10-30',
      start_time: '19:30',
      end_date: '2026-10-30',
      end_time: '22:00',
      is_all_day: false,
      location: 'Forum',
      notes: 'Row F',
      reminder_days: [1],
      cost: 45.5,
      travel_mode: 'walk',
    });
  });

  it('starts a new event on the defaults, on Drive with a home', () => {
    const form = initialEventForm(null, { defaultDate: '2026-11-02', defaultTime: '14:15', hasHome: true });
    expect(form).toMatchObject({ title: '', category: 'general', start_date: '2026-11-02', start_time: '14:15', cost: null, travel_mode: 'drive' });
    expect(initialEventForm(null, { hasHome: false })).toMatchObject({ start_date: todayISO(), start_time: '09:00', travel_mode: null });
  });
});

describe('eventFromForm', () => {
  const form = (over: Partial<EventForm> = {}): EventForm => ({ ...initialEventForm(null, { defaultDate: '2026-11-02', hasHome: true }), title: ' Dinner ', ...over });

  it('needs a title', () => {
    expect(eventFromForm(form({ title: '  ' }), ctx)).toBeNull();
  });

  it('builds a new event with trimmed fields and its Budget line', () => {
    const result = eventFromForm(form({ location: ' Cafe ', notes: ' ', cost: 12.345 }), ctx);
    expect(result?.costCents).toBe(1235);
    expect(result?.event).toMatchObject({
      id: 'new-1',
      group_id: 'g1',
      created_by: null,
      title: 'Dinner',
      starts_at: localDateTimeToISO('2026-11-02', '09:00'),
      ends_at: null,
      location: 'Cafe',
      notes: null,
      travel_mode: 'drive',
      travel_minutes: 20,
      deleted: false,
    });
    expect(eventFromForm(form({ cost: 12 }), { ...ctx, showBudget: false })?.costCents).toBeNull();
  });

  it('starts an all-day event at midnight, with no end and no trip', () => {
    const result = eventFromForm(form({ is_all_day: true, end_date: '2026-11-02', end_time: '10:00' }), ctx);
    expect(result?.event).toMatchObject({ starts_at: localDateTimeToISO('2026-11-02', '00:00'), ends_at: null, travel_mode: null, travel_minutes: null });
  });

  it('keeps the saved trip while the lookup loads on an unchanged place', () => {
    const editing = initialEventForm(saved, { hasHome: true });
    const keep = eventFromForm(editing, { ...ctx, event: saved, travelMinutes: undefined });
    expect(keep?.event).toMatchObject({ id: 'e1', created_by: 'u1', travel_minutes: 12, private: true });
    expect(eventFromForm({ ...editing, location: 'Arena' }, { ...ctx, event: saved, travelMinutes: undefined })?.event.travel_minutes).toBeNull();
    expect(eventFromForm(editing, { ...ctx, event: saved, travelMinutes: null })?.event.travel_minutes).toBeNull();
  });
});
