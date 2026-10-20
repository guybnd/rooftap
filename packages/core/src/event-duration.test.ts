import { describe, expect, it } from 'vitest';
import {
  durationText,
  eventDurationChoice,
  eventDurationMinutes,
  eventEndText,
  withEventDuration,
  withEventStart,
  type EventTiming,
} from './event-duration';

const base: EventTiming = { start_date: '2026-11-07', start_time: '10:00', end_date: '', end_time: '', is_all_day: false };

describe('event duration', () => {
  it('sets the end from a bucket and reads it back as that bucket', () => {
    const t = withEventDuration(base, 120);
    expect(t).toMatchObject({ end_date: '2026-11-07', end_time: '12:00' });
    expect(eventDurationMinutes(t)).toBe(120);
    expect(eventDurationChoice(t)).toBe(120);
  });

  it('rolls an end past midnight onto the next day', () => {
    const t = withEventDuration({ ...base, start_time: '23:00' }, 180);
    expect(t).toMatchObject({ end_date: '2026-11-08', end_time: '02:00' });
    expect(eventEndText(t)).toBe('Ends Sun 8, 2:00am (3h)');
  });

  it('calls an end that matches no bucket custom, and no end nothing', () => {
    expect(eventDurationChoice({ ...base, end_date: '2026-11-07', end_time: '11:45' })).toBe('custom');
    expect(eventDurationChoice(base)).toBeNull();
    expect(eventEndText(base)).toBe('No end time');
  });

  it('all day drops the end, and null clears it', () => {
    const allDay = withEventDuration(withEventDuration(base, 60), 'all-day');
    expect(allDay).toMatchObject({ is_all_day: true, end_date: '', end_time: '' });
    expect(eventDurationChoice(allDay)).toBe('all-day');
    expect(withEventDuration(withEventDuration(base, 60), null)).toMatchObject({ end_date: '', end_time: '' });
  });

  it('moving the start keeps the duration', () => {
    const t = withEventStart(withEventDuration(base, 90), '2026-11-08', '18:30');
    expect(t).toMatchObject({ start_date: '2026-11-08', start_time: '18:30', end_date: '2026-11-08', end_time: '20:00' });
    expect(eventEndText(t)).toBe('Ends 8:00pm (1h 30m)');
  });

  it('formats durations', () => {
    expect(durationText(45)).toBe('45m');
    expect(durationText(60)).toBe('1h');
    expect(durationText(150)).toBe('2h 30m');
  });
});
