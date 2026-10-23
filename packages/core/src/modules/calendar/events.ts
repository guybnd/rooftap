// FLUX-249: category metadata for group `events` — mirrors the DOC_TYPE_META /
// DOC_TYPE_PICKER_OPTIONS pattern in documents.ts (label + color map, fed to
// SearchablePicker), but styled for the calendar's light event-card chrome
// (bg-*-500/10 + border + text-*-800, matching getCalendarEventClasses).

import type { EventCategory, GroupEvent } from '../../types';
import type { PickerOption } from "../../types";

export const EVENT_CATEGORY_META: Record<EventCategory, { label: string; classes: string }> = {
  general: { label: "General", classes: "bg-slate-500/10 border-slate-500/30 hover:bg-slate-500/20 hover:border-slate-500/50 text-slate-800" },
  medical: { label: "Medical", classes: "bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20 hover:border-rose-500/50 text-rose-800" },
  social: { label: "Social", classes: "bg-fuchsia-500/10 border-fuchsia-500/30 hover:bg-fuchsia-500/20 hover:border-fuchsia-500/50 text-fuchsia-800" },
  household: { label: "Household", classes: "bg-teal-500/10 border-teal-500/30 hover:bg-teal-500/20 hover:border-teal-500/50 text-teal-800" },
  finance: { label: "Finance", classes: "bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-500/50 text-amber-800" },
  school: { label: "School", classes: "bg-indigo-500/10 border-indigo-500/30 hover:bg-indigo-500/20 hover:border-indigo-500/50 text-indigo-800" },
  travel: { label: "Travel", classes: "bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20 hover:border-sky-500/50 text-sky-800" },
  work: { label: "Work", classes: "bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20 hover:border-orange-500/50 text-orange-800" },
};

export const EVENT_CATEGORY_PICKER_OPTIONS: PickerOption[] = (
  Object.keys(EVENT_CATEGORY_META) as EventCategory[]
).map((k) => ({ value: k, primary: EVENT_CATEGORY_META[k].label, group: null }));

export function eventCategoryLabel(category: string): string {
  return EVENT_CATEGORY_META[category as EventCategory]?.label ?? category;
}

export function eventCategoryClasses(category: string): string {
  return EVENT_CATEGORY_META[category as EventCategory]?.classes ?? EVENT_CATEGORY_META.general.classes;
}

/** A group event's one-line detail for agenda rows: where it is when a place
 *  was entered, else its category. A saved place used to show nowhere outside
 *  the edit form, so it read as never saved. */
export function eventDetailLabel(event: { location: string | null; category: string }): string {
  return event.location?.trim() || eventCategoryLabel(event.category);
}

/** A maps search link for a free-text place ("Queen Victoria Market"). Google
 *  Maps' universal URL opens the Maps app on Android and iOS and the site on web. */
export function mapsSearchUrl(place: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.trim())}`;
}

const DIRECTIONS_MODE: Record<string, string> = { drive: 'driving', walk: 'walking', cycle: 'bicycling' };

/** Directions to a free-text place from wherever the phone is, by the event's
 *  travel mode when it has one. Same universal Google Maps URL as above. */
export function mapsDirectionsUrl(place: string, travelMode?: string | null): string {
  const mode = travelMode ? DIRECTIONS_MODE[travelMode] : undefined;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.trim())}${mode ? `&travelmode=${mode}` : ''}`;
}

/** "Tue 28 Oct" for an all-day event, else "Tue 28 Oct, 6:30pm". */
export function eventWhenText(event: Pick<GroupEvent, 'starts_at' | 'is_all_day'>): string {
  const start = new Date(event.starts_at);
  const day = start.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  if (event.is_all_day) return day;
  return `${day}, ${start.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase()}`;
}
