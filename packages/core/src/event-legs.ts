// Travel between back-to-back events (household feedback, carried over from
// Home Search's viewing agenda): between two events with places on the same
// day, or a few hours apart across midnight, the agenda says how long the trip
// is, and warns when the gap is shorter than the trip.
import type { GroupEvent } from './types';
import { isTravelMode, travelText, type TravelMode } from './event-travel';

/** Events further apart than this across midnight get no leg. */
export const LEG_MAX_OVERNIGHT_GAP_MINUTES = 4 * 60;

export interface EventLeg {
  fromId: string;
  toId: string;
  /** The first event's place, as typed. */
  from: string;
  to: string;
  /** The second event's travel mode, else the first's, else driving. */
  mode: TravelMode;
  /** Minutes between the first ending (or starting, without an end) and the second starting; 0 when they overlap. */
  gapMinutes: number;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const placeKey = (place: string) => place.trim().toLowerCase().replace(/\s+/g, ' ');

/** The legs between consecutive timed events that both have a place, soonest first. */
export function eventTravelLegs(events: readonly GroupEvent[]): EventLeg[] {
  const timed = events
    .filter((e) => !e.deleted && !e.is_all_day && e.location?.trim())
    .slice()
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const legs: EventLeg[] = [];
  for (let i = 1; i < timed.length; i++) {
    const a = timed[i - 1];
    const b = timed[i];
    const from = a.location!.trim();
    const to = b.location!.trim();
    if (placeKey(from) === placeKey(to)) continue;
    const aEnd = new Date(a.ends_at ?? a.starts_at);
    const bStart = new Date(b.starts_at);
    const gap = Math.round((bStart.getTime() - aEnd.getTime()) / 60_000);
    if (!sameLocalDay(new Date(a.starts_at), bStart) && gap > LEG_MAX_OVERNIGHT_GAP_MINUTES) continue;
    const mode = isTravelMode(b.travel_mode) ? b.travel_mode : isTravelMode(a.travel_mode) ? a.travel_mode : 'drive';
    legs.push({ fromId: a.id, toId: b.id, from, to, mode, gapMinutes: Math.max(0, gap) });
  }
  return legs;
}

/** The agenda's line for a leg once its trip is known: whether it fits the gap, and what to say. */
export function legText(leg: EventLeg, minutes: number): { text: string; tight: boolean } {
  const trip = travelText(minutes, leg.mode);
  if (minutes <= leg.gapMinutes) return { text: `${trip} to get there`, tight: false };
  if (leg.gapMinutes === 0) return { text: `${trip}, and they overlap`, tight: true };
  return { text: `${trip}, only ${leg.gapMinutes} min between`, tight: true };
}
