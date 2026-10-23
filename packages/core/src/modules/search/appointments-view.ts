// Appointments (Home Search viewings): the list helpers both apps'
// Appointments screens share. The apps keep their own rows, transit legs,
// sheets and pickers.

import type { Apartment, Appointment } from '../../types';
import { formatRelativeDay, toISODate } from '../../date-utils';

/** H6: a 12-hour clock time, "10:30 AM" (never "10:30 am" or a 24h pair). */
export function appointmentClockTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * H6: a relative day read mid-caption ("Next: tomorrow 6:30 PM"). Today and
 * Tomorrow drop their capital; weekday and dated labels keep theirs.
 */
export function relativeDayFragment(date: Date, now: Date = new Date()): string {
  const day = formatRelativeDay(date, now);
  return day === 'Today' || day === 'Tomorrow' ? day.toLowerCase() : day;
}

/**
 * Upcoming viewings grouped by local day, soonest first, and past ones
 * newest first. A viewing counts as upcoming until its start time.
 */
export function groupAppointments(
  appointments: readonly Appointment[],
  now: Date = new Date(),
): { upcomingGroups: Appointment[][]; upcomingCount: number; past: Appointment[] } {
  const sorted = [...appointments].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  const upcomingList = sorted.filter((a) => new Date(a.scheduled_at) >= now);
  const pastList = sorted.filter((a) => new Date(a.scheduled_at) < now).reverse();
  const groups: Appointment[][] = [];
  for (const appt of upcomingList) {
    const dateStr = toISODate(new Date(appt.scheduled_at));
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && toISODate(new Date(lastGroup[0].scheduled_at)) === dateStr) lastGroup.push(appt);
    else groups.push([appt]);
  }
  return { upcomingGroups: groups, upcomingCount: upcomingList.length, past: pastList };
}

/**
 * The pulse strip under the Hero (H1): "This week" only when it says
 * something the Hero doesn't (fewer than all upcoming), "Optional" only
 * when there are any.
 */
export function appointmentPulse(
  upcoming: readonly Appointment[],
  now: Date = new Date(),
): { thisWeekCount: number; optionalCount: number; showWeek: boolean; showOptional: boolean } {
  const weekFromNow = new Date(now);
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const thisWeekCount = upcoming.filter((a) => new Date(a.scheduled_at) <= weekFromNow).length;
  // No "confirmed" field on Appointment: "optional" (a booking you may skip)
  // is the closest status to a not-yet-firm booking.
  const optionalCount = upcoming.filter((a) => a.status === 'optional').length;
  return {
    thisWeekCount,
    optionalCount,
    showWeek: thisWeekCount > 0 && thisWeekCount < upcoming.length,
    showOptional: optionalCount > 0,
  };
}

/** The booking picker's apartments: not archived, matching the search on address or suburb. */
export function bookableApartments<T extends Pick<Apartment, 'archived' | 'address' | 'suburb'>>(apartments: readonly T[], search: string): T[] {
  const q = search.toLowerCase();
  return apartments.filter(
    (a) => !a.archived && (!search.trim() || a.address.toLowerCase().includes(q) || (!!a.suburb && a.suburb.toLowerCase().includes(q))),
  );
}

/** Mark viewed toggles between viewed and scheduled. */
export function toggledViewedStatus(status: Appointment['status']): Appointment['status'] {
  return status === 'viewed' ? 'scheduled' : 'viewed';
}
