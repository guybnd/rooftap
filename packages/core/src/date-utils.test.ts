import { describe, expect, it } from 'vitest';
import { dueDayLabel, formatPastDay, formatRelativeDay, formatTime12h, localDateOf, localDateTimeToISO, localTimeOf, pad2, recurrenceLabel, taskSnoozePatch } from './date-utils';

describe('taskSnoozePatch', () => {
  const task = { due_date: '2026-10-18', due_time: '09:30' };

  it('1h nudges the time and keeps the date', () => {
    expect(taskSnoozePatch(task, '1h')).toEqual({ due_time: '10:30' });
  });

  it('pushes the due date by 1 day, 1 week and 1 month (30 days)', () => {
    expect(taskSnoozePatch(task, '1d')).toEqual({ due_date: '2026-10-19' });
    expect(taskSnoozePatch(task, '1w')).toEqual({ due_date: '2026-10-25' });
    expect(taskSnoozePatch(task, '1m')).toEqual({ due_date: '2026-11-17' });
  });

  it('counts from today when the task has no due date', () => {
    expect(taskSnoozePatch({ due_date: null, due_time: null }, '1m', '2026-01-15')).toEqual({ due_date: '2026-02-14' });
  });

  it('uses a custom date verbatim', () => {
    expect(taskSnoozePatch(task, '2027-01-05')).toEqual({ due_date: '2027-01-05' });
  });
});

describe('formatTime12h', () => {
  it('formats wall-clock HH:MM as 12-hour time', () => {
    expect(formatTime12h('00:05')).toBe('12:05 AM');
    expect(formatTime12h('09:30')).toBe('9:30 AM');
    expect(formatTime12h('12:00')).toBe('12:00 PM');
    expect(formatTime12h('23:59')).toBe('11:59 PM');
  });

  it('returns an empty string for a missing time', () => {
    expect(formatTime12h(null)).toBe('');
    expect(formatTime12h('')).toBe('');
  });

  it('pads single digits', () => {
    expect(pad2(7)).toBe('07');
    expect(pad2(12)).toBe('12');
  });
});

describe('formatRelativeDay', () => {
  const now = new Date(2026, 9, 18, 15, 0); // Sun 18 Oct 2026, 3pm local

  it('names today and tomorrow regardless of time of day', () => {
    expect(formatRelativeDay(new Date(2026, 9, 18, 0, 1), now)).toBe('Today');
    expect(formatRelativeDay(new Date(2026, 9, 19, 23, 0), now)).toBe('Tomorrow');
  });

  it('uses the weekday within six days, then a dated label', () => {
    expect(formatRelativeDay(new Date(2026, 9, 24), now)).toBe('Saturday');
    expect(formatRelativeDay(new Date(2026, 9, 25), now)).toBe('Sun, Oct 25');
    expect(formatRelativeDay(new Date(2026, 9, 17), now)).toBe('Sat, Oct 17');
  });
});

describe('dueDayLabel', () => {
  const today = '2026-10-18'; // a Sunday
  it('counts overdue days', () => {
    expect(dueDayLabel('2026-10-15', today)).toBe('3d overdue');
  });
  it('names today and tomorrow', () => {
    expect(dueDayLabel(today, today)).toBe('Today');
    expect(dueDayLabel('2026-10-19', today)).toBe('Tomorrow');
  });
  it('uses a short weekday inside the week, then a short date', () => {
    expect(dueDayLabel('2026-10-22', today)).toBe('Thu');
    expect(dueDayLabel('2026-10-25', today)).toBe('Oct 25');
  });
});

describe('formatPastDay', () => {
  const now = new Date(2026, 9, 18, 9, 0); // Sun, Oct 18
  it('says today and yesterday', () => {
    expect(formatPastDay(new Date(2026, 9, 18, 7, 0), now)).toBe('Today');
    expect(formatPastDay(new Date(2026, 9, 17, 22, 0), now)).toBe('Yesterday');
  });
  it('uses a short weekday within the week, then a short date', () => {
    expect(formatPastDay(new Date(2026, 9, 15), now)).toBe('Thu');
    expect(formatPastDay(new Date(2026, 9, 11), now)).toBe('Oct 11');
  });
});

describe('local date and time fields', () => {
  it('round-trips a local date and time through an instant', () => {
    const iso = localDateTimeToISO('2026-10-23', '18:05');
    expect(localDateOf(iso)).toBe('2026-10-23');
    expect(localTimeOf(iso)).toBe('18:05');
  });

  it('takes an empty time as midnight', () => {
    expect(localTimeOf(localDateTimeToISO('2026-10-23', ''))).toBe('00:00');
  });
});

describe('recurrenceLabel', () => {
  it('names common intervals', () => {
    expect([1, 3, 7, 14, 21, 30, 90, 45].map(recurrenceLabel)).toEqual([
      'Daily',
      'Every 3 days',
      'Weekly',
      'Fortnightly',
      'Every 3 weeks',
      'Monthly',
      'Every 3 months',
      'Every 45 days',
    ]);
  });
});
