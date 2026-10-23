"use client";

// Google Calendar overlay: the web app's calls to /api/calendar/*, through
// core's shared client so request shapes match native. Native twin:
// apps/mobile/src/features/calendar/calendar-api.ts.
import { createCalendarApi } from "@homeup/core";

export const calendarApi = createCalendarApi((path, init) =>
  fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
);
