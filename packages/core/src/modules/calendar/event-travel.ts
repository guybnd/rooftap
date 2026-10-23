// "Time to leave" for calendar events (household feedback: "notif when to
// leave based on travel time to venue"). An event with a travel mode gets a
// travel time from home at save (/api/event-travel: Mapbox directions from the
// household's home to the event's place), and the notify-leave-time job pushes
// "Leave by 6:40pm" a few minutes before then. The push side's Deno twin is
// supabase/functions/_shared/event-travel.ts, checked by event-travel.test.ts.

export type TravelMode = 'drive' | 'walk' | 'cycle';

export const TRAVEL_MODE_OPTIONS: { value: TravelMode | 'off'; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'drive', label: 'Drive' },
  { value: 'walk', label: 'Walk' },
  { value: 'cycle', label: 'Cycle' },
];

/** Mapbox Directions profile for each mode (driving uses live traffic). */
export const MAPBOX_PROFILE: Record<TravelMode, string> = {
  drive: 'driving-traffic',
  walk: 'walking',
  cycle: 'cycling',
};

/** Spare minutes on top of the travel time: parking, finding the door. */
export const LEAVE_BUFFER_MINUTES = 10;

/** How long before leaving the "time to leave" push comes (user_settings.leave_alert_minutes; null = an hour). */
export const LEAVE_ALERT_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
] as const;
export const DEFAULT_LEAVE_ALERT_MINUTES = 60;

export function leaveAlertMinutes(settings: { leave_alert_minutes?: number | null } | null | undefined): number {
  const v = settings?.leave_alert_minutes;
  return LEAVE_ALERT_OPTIONS.some((o) => o.value === v) ? (v as number) : DEFAULT_LEAVE_ALERT_MINUTES;
}

/** "an hour", "30 min". */
function alertWords(minutes: number): string {
  return minutes === 60 ? 'an hour' : `${minutes} min`;
}

const MODE_WORDS: Record<TravelMode, string> = { drive: 'by car', walk: 'walking', cycle: 'by bike' };

/** When to leave home to arrive on time. */
export function leaveAt(startsAt: string, travelMinutes: number): Date {
  return new Date(new Date(startsAt).getTime() - (travelMinutes + LEAVE_BUFFER_MINUTES) * 60_000);
}

/** "28 min by car" or "1 hr 5 min walking". */
export function travelText(minutes: number, mode: TravelMode): string {
  const m = Math.max(1, Math.round(minutes));
  const time = m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
  return `${time} ${MODE_WORDS[mode]}`;
}

export function isTravelMode(value: unknown): value is TravelMode {
  return value === 'drive' || value === 'walk' || value === 'cycle';
}

/** The "Getting there" row's hint for the event form. */
export function travelHint(input: {
  mode: TravelMode | null;
  hasHome: boolean;
  hasPlace: boolean;
  minutes: number | null | undefined;
  startsAt: string;
  formatClock: (d: Date) => string;
  /** The person's alert lead time (leaveAlertMinutes). */
  alertMinutes?: number;
}): string | undefined {
  if (!input.mode) return undefined;
  if (!input.hasHome) return 'Add your home address in Settings to work out when to leave.';
  if (!input.hasPlace) return 'Add a location to work out when to leave.';
  if (input.minutes === undefined) return 'Working out the travel time…';
  if (input.minutes === null) return "Couldn't work out the travel time to this place.";
  const alert = alertWords(input.alertMinutes ?? DEFAULT_LEAVE_ALERT_MINUTES);
  return `${travelText(input.minutes, input.mode)}. Leave by ${input.formatClock(leaveAt(input.startsAt, input.minutes))}; you'll get a push ${alert} before.`;
}
