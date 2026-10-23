'use client';

// Appointments: the list state both apps' Appointments screens share. The
// apps read the stores and keep their own rows, sheets and pickers.

import { useMemo } from 'react';
import type { Apartment, Appointment } from '../../types';
import { appointmentPulse, groupAppointments } from './appointments-view';

/** Upcoming day groups, past viewings, the next viewing for the Hero, and the pulse strip. */
export function useAppointmentsOverview<A extends Pick<Apartment, 'id'>>(appointments: Appointment[], apartments: A[]) {
  const { upcomingGroups, upcomingCount, past } = useMemo(() => groupAppointments(appointments), [appointments]);
  const upcomingFlat = useMemo(() => upcomingGroups.flat(), [upcomingGroups]);
  const pulse = useMemo(() => appointmentPulse(upcomingFlat), [upcomingFlat]);
  const nextAppt = upcomingFlat[0] ?? null;
  const nextApartment = nextAppt ? apartments.find((a) => a.id === nextAppt.apartment_id) ?? null : null;
  const nextDate = nextAppt ? new Date(nextAppt.scheduled_at) : null;
  return { upcomingGroups, upcomingCount, past, upcomingFlat, nextAppt, nextApartment, nextDate, ...pulse };
}
