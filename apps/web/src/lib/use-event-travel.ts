"use client";

import { useEventTravelMinutes, useLegTravelMinutes, type EventLeg, type EventTravel, type TravelMode } from "@homeup/core";
import { useDataCache } from "@/lib/data-cache";
import { eventLookups } from "@/lib/event-lookups";

// Travel minutes from the household's home to an event's place, from
// /api/event-travel. `undefined` while unknown or loading, `null` when it
// couldn't be worked out. Logic and cache live in core (use-event-lookups.ts).
export function useEventTravel(place: string, mode: TravelMode | null, debounceMs = 600): EventTravel {
  const { group } = useDataCache();
  return useEventTravelMinutes(eventLookups, place, mode, group, debounceMs);
}

/** Travel minutes for a leg between two events (core event-legs.ts), same states as above. */
export function useLegTravel(leg: EventLeg | null): number | null | undefined {
  return useLegTravelMinutes(eventLookups, leg);
}
