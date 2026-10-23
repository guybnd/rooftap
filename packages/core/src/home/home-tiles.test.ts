import { describe, expect, it } from 'vitest';
import type { ApartmentWithScore, Appointment } from '../types';
import { homeSearchGlance } from './home-tiles';

const listing = (id: string, percentage: number | null, archived = false) =>
  ({ id, address: `${id} St`, archived, score: percentage == null ? null : { percentage } }) as unknown as ApartmentWithScore;
const viewing = (id: string, apartment_id: string, scheduled_at: string, status = 'scheduled') =>
  ({ id, apartment_id, scheduled_at, status }) as unknown as Appointment;

describe('homeSearchGlance', () => {
  const now = new Date('2026-10-23T12:00:00Z').getTime();

  it('picks the soonest scheduled viewing from now and the best listing still in the search', () => {
    const glance = homeSearchGlance(
      [listing('a', 70), listing('b', 90, true), listing('c', 80), listing('d', null)],
      [
        viewing('past', 'a', '2026-10-22T12:00:00Z'),
        viewing('later', 'a', '2026-10-26T12:00:00Z'),
        viewing('soon', 'c', '2026-10-24T12:00:00Z'),
        viewing('off', 'a', '2026-10-23T13:00:00Z', 'cancelled'),
      ],
      now
    );
    expect(glance.nextAppointment?.id).toBe('soon');
    expect(glance.appointmentAt?.toISOString()).toBe('2026-10-24T12:00:00.000Z');
    expect(glance.appointmentAddress).toBe('c St');
    expect(glance.topListing?.id).toBe('c');
  });

  it('says Viewing when the listing is gone, and has nothing without data', () => {
    expect(homeSearchGlance([], [viewing('v', 'gone', '2026-10-24T12:00:00Z')], now).appointmentAddress).toBe('Viewing');
    expect(homeSearchGlance([], [], now)).toEqual({ nextAppointment: null, appointmentAt: null, appointmentAddress: null, topListing: null });
  });
});
