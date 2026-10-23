// The forecast line for a calendar event within range: native side of
// apps/web/src/lib/use-event-forecast.ts. /api/event-forecast geocodes the
// place (the household's home stands in without one). Logic and cache live
// in core (use-event-lookups.ts).
import { useEventForecastText } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { eventLookups } from './event-lookups';

export function useEventForecast(
  event: { starts_at: string; is_all_day: boolean; location: string | null } | null,
  debounceMs = 0
): string | null {
  const { group } = useDataCache();
  return useEventForecastText(eventLookups, event, group, debounceMs);
}
