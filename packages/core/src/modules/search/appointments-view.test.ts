import { describe, expect, it } from 'vitest';
import type { Appointment } from '../../types';
import {
  appointmentClockTime,
  appointmentPulse,
  bookableApartments,
  groupAppointments,
  relativeDayFragment,
  toggledViewedStatus,
} from './appointments-view';

function appt(id: string, at: Date, status: Appointment['status'] = 'scheduled'): Appointment {
  return {
    id,
    user_id: 'u',
    group_id: 'g',
    apartment_id: `apt-${id}`,
    scheduled_at: at.toISOString(),
    notes: null,
    status,
    created_at: '',
    updated_at: '',
    deleted: false,
  };
}

const NOW = new Date(2026, 9, 23, 12, 0);
const at = (days: number, hour: number) => new Date(2026, 9, 23 + days, hour, 0);

describe('appointment labels', () => {
  it('writes 12-hour times', () => {
    expect(appointmentClockTime(new Date(2026, 9, 23, 18, 30))).toBe('6:30 PM');
  });

  it('lower-cases today and tomorrow mid-caption', () => {
    expect(relativeDayFragment(at(0, 15), NOW)).toBe('today');
    expect(relativeDayFragment(at(1, 9), NOW)).toBe('tomorrow');
    expect(relativeDayFragment(at(3, 9), NOW)).not.toMatch(/^[a-z]/);
  });

  it('toggles viewed', () => {
    expect(toggledViewedStatus('viewed')).toBe('scheduled');
    expect(toggledViewedStatus('scheduled')).toBe('viewed');
    expect(toggledViewedStatus('optional')).toBe('viewed');
  });
});

describe('groupAppointments', () => {
  it('groups upcoming by day and lists past newest first', () => {
    const list = [appt('c', at(1, 9)), appt('a', at(0, 15)), appt('b', at(0, 16)), appt('old', at(-2, 9)), appt('older', at(-5, 9))];
    const { upcomingGroups, upcomingCount, past } = groupAppointments(list, NOW);
    expect(upcomingGroups.map((g) => g.map((a) => a.id))).toEqual([['a', 'b'], ['c']]);
    expect(upcomingCount).toBe(3);
    expect(past.map((a) => a.id)).toEqual(['old', 'older']);
  });
});

describe('appointmentPulse', () => {
  it('shows This week only when it is fewer than all upcoming', () => {
    const soon = [appt('a', at(1, 9)), appt('b', at(2, 9), 'optional')];
    expect(appointmentPulse(soon, NOW)).toEqual({ thisWeekCount: 2, optionalCount: 1, showWeek: false, showOptional: true });
    const later = [...soon, appt('c', at(20, 9))];
    expect(appointmentPulse(later, NOW)).toMatchObject({ thisWeekCount: 2, showWeek: true });
    expect(appointmentPulse([], NOW)).toEqual({ thisWeekCount: 0, optionalCount: 0, showWeek: false, showOptional: false });
  });
});

describe('bookableApartments', () => {
  const list = [
    { id: '1', address: '12 King St', suburb: 'Newtown', archived: false },
    { id: '2', address: '3 Queen Rd', suburb: null, archived: false },
    { id: '3', address: '9 King St', suburb: 'Erskineville', archived: true },
  ];

  it('drops archived ones and matches address or suburb', () => {
    expect(bookableApartments(list, '').map((a) => a.id)).toEqual(['1', '2']);
    expect(bookableApartments(list, 'king').map((a) => a.id)).toEqual(['1']);
    expect(bookableApartments(list, 'NEWTOWN').map((a) => a.id)).toEqual(['1']);
    expect(bookableApartments(list, 'zzz')).toEqual([]);
  });
});
