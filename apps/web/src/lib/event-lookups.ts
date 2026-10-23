"use client";

// The calendar's forecast and travel lookups, through core's shared cache so
// both apps ask the same way. Native twin:
// apps/mobile/src/features/calendar/event-lookups.ts.
import { createEventLookups } from "@homeup/core";

export const eventLookups = createEventLookups(async (path) => {
  const res = await fetch(path);
  return res.ok ? res.json() : null;
});
