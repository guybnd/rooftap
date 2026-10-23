// Modules: what the calendar shows from other modules (module-features.ts).
// Both calendar screens read the two switches with useModules().feature();
// these pure helpers apply them where copy or pulled data depends on both, so
// web and mobile agree and the gate is testable.
import type { GoogleCalendarEventWithAttribution } from '../../types';

export interface CalendarSources {
  /** `calendar.tasks`: dated tasks, "New to-do", and "Add as to-do" on a Google event. */
  tasks: boolean;
  /** `calendar.viewings`: viewings, "Apartment viewing", "Import as appointment", and viewing suggestions. */
  viewings: boolean;
}

/** "an appointment, event, or to-do", naming only what the calendar can add. */
export function calendarAddPhrase(sources: CalendarSources): string {
  const kinds: string[] = [];
  if (sources.viewings) kinds.push('appointment');
  kinds.push('event');
  if (sources.tasks) kinds.push('to-do');
  if (kinds.length === 1) return `an ${kinds[0]}`;
  if (kinds.length === 2) return `an ${kinds[0]} or ${kinds[1]}`;
  return `an ${kinds.slice(0, -1).join(', ')}, or ${kinds[kinds.length - 1]}`;
}

/**
 * Modules: a "looks like a viewing" suggestion needs calendar and search
 * (module-features.ts). With viewings off, a Google event the classifier
 * flagged shows as a plain one: no badge, no warning style, no Dismiss.
 */
export function hideViewingSuggestions(
  events: GoogleCalendarEventWithAttribution[],
  viewings: boolean
): GoogleCalendarEventWithAttribution[] {
  if (viewings) return events;
  return events.map((ev) => (ev.state === 'suggested' ? { ...ev, state: 'synced' } : ev));
}
