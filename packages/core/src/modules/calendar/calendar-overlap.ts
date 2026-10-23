// HOUP-87: the calendar's three per-day overlap-layout algorithms
// (apps/web/src/app/calendar/page.tsx's computeOverlapLayout /
// computeEventOverlapLayout / computeCalendarOverlapLayout), extracted so
// the native Day grid (apps/mobile/src/app/calendar) can share the exact
// same column-packing math instead of re-deriving it. Pure — no browser
// globals, no node:* builtins (packages/core/scripts/check-import-boundary.mjs).
//
// All three call sites did the *same* interval-packing algorithm on
// differently-shaped items, so it's factored into one generic packer
// (packIntervals) plus three thin, name-preserving wrappers that match the
// original web signatures (computeOverlapLayout keeps a `durationMinutes`
// param — the only one of the three whose item has no intrinsic end time).
import type { Appointment, GoogleCalendarEventWithAttribution, GroupEvent } from "../../types";

export interface OverlapLayoutEntry<T> {
  start: number;
  end: number;
  col: number;
  totalCols: number;
  item: T;
}

interface TimedItem<T> {
  item: T;
  start: number;
  end: number;
}

/**
 * Packs a day's worth of [start, end) hour-offset intervals into the fewest
 * side-by-side columns such that no two overlapping intervals share a
 * column, then stamps every entry with the total column count of its
 * overlap group (so callers can render each as `100 / totalCols`% wide).
 * Intervals outside [0, visibleHours] are clamped in, never dropped
 * (FLUX-1562) — an item straddling the window edge still renders in the
 * portion that's visible.
 */
function packIntervals<T>(entries: TimedItem<T>[], visibleHours: number): OverlapLayoutEntry<T>[] {
  const items = entries
    .map((e) => ({ ...e, start: Math.max(0, e.start), end: Math.min(visibleHours, e.end) }))
    .filter((e) => e.end > e.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const columns: { end: number }[][] = [];
  const result: OverlapLayoutEntry<T>[] = [];

  for (const entry of items) {
    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      const lastInCol = columns[col][columns[col].length - 1];
      if (lastInCol.end <= entry.start) {
        columns[col].push({ end: entry.end });
        result.push({ ...entry, col, totalCols: 0 });
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([{ end: entry.end }]);
      result.push({ ...entry, col: columns.length - 1, totalCols: 0 });
    }
  }

  for (let i = 0; i < result.length; i++) {
    let maxCol = result[i].col;
    for (let j = 0; j < result.length; j++) {
      if (i !== j && result[j].start < result[i].end && result[j].end > result[i].start) {
        maxCol = Math.max(maxCol, result[j].col);
      }
    }
    result[i].totalCols = maxCol + 1;
  }

  return result;
}

/** Appointments have no end time of their own — `durationMinutes` comes from the caller's `appointment_duration_minutes` user setting. */
export function computeOverlapLayout(
  dayApps: Appointment[],
  durationMinutes: number,
  startHour = 0,
  endHour = 24
): (OverlapLayoutEntry<Appointment> & { app: Appointment })[] {
  const items = dayApps.map((app) => {
    const d = new Date(app.scheduled_at);
    const start = d.getHours() + d.getMinutes() / 60 - startHour;
    return { item: app, start, end: start + durationMinutes / 60 };
  });
  return packIntervals(items, endHour - startHour).map((e) => ({ ...e, app: e.item }));
}

function computeTimedEventOverlapLayout<T extends { starts_at: string; ends_at: string | null; is_all_day: boolean }>(
  dayEvents: T[],
  startHour: number,
  endHour: number
): (OverlapLayoutEntry<T> & { event: T })[] {
  const items = dayEvents
    .filter((ev) => !ev.is_all_day)
    .map((ev) => {
      const start = new Date(ev.starts_at);
      const startOffset = start.getHours() + start.getMinutes() / 60 - startHour;
      const endDate = ev.ends_at ? new Date(ev.ends_at) : new Date(start.getTime() + 30 * 60000);
      // A multi-day timed event's block on its start day (the only day this
      // packer is ever handed such an event for) should run to the bottom of
      // the column, not clamp to the later day's clock hour — which is often
      // *earlier* than the start hour and collapses to a 15-min sliver (HOUP-104).
      const spansPastStartDay =
        endDate.getFullYear() !== start.getFullYear() ||
        endDate.getMonth() !== start.getMonth() ||
        endDate.getDate() !== start.getDate();
      const endOffset = spansPastStartDay
        ? endHour - startHour
        : Math.max(endDate.getHours() + endDate.getMinutes() / 60 - startHour, startOffset + 0.25);
      return { item: ev, start: startOffset, end: endOffset };
    });
  return packIntervals(items, endHour - startHour).map((e) => ({ ...e, event: e.item }));
}

export function computeEventOverlapLayout(dayEvents: GroupEvent[], startHour = 0, endHour = 24) {
  return computeTimedEventOverlapLayout(dayEvents, startHour, endHour);
}

export function computeCalendarOverlapLayout(
  dayEvents: GoogleCalendarEventWithAttribution[],
  startHour = 0,
  endHour = 24
) {
  return computeTimedEventOverlapLayout(dayEvents, startHour, endHour);
}

/** Calendar-day (not timestamp) bounds an event spans — [startDay, endDay]
 *  inclusive. A null/same-day ends_at collapses to a single-day range. */
export function getEventDayBounds(ev: { starts_at: string; ends_at: string | null }): { startDay: Date; endDay: Date } {
  const start = new Date(ev.starts_at);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let end = ev.ends_at ? new Date(ev.ends_at) : start;
  // An end landing exactly on local midnight doesn't occupy any part of that
  // calendar day (e.g. a 20:00->00:00 event) — back it up an instant so the
  // day-bounds don't spuriously include the following day (HOUP-104).
  if (
    end.getTime() > start.getTime() &&
    end.getHours() === 0 &&
    end.getMinutes() === 0 &&
    end.getSeconds() === 0 &&
    end.getMilliseconds() === 0
  ) {
    end = new Date(end.getTime() - 1);
  }
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return endDay < startDay ? { startDay, endDay: startDay } : { startDay, endDay };
}

/** Is `date` the first day this event appears on? Later spanned days render in
 *  an all-day band/row instead of a timed block (FLUX-259). */
export function isEventStartDay(ev: { starts_at: string; ends_at: string | null }, date: Date): boolean {
  const { startDay } = getEventDayBounds(ev);
  return (
    startDay.getFullYear() === date.getFullYear() &&
    startDay.getMonth() === date.getMonth() &&
    startDay.getDate() === date.getDate()
  );
}

/** Matches any day within an event's [starts_at, ends_at] range, not just the
 *  start day, so multi-day events render on every day they span (FLUX-259). */
export function getEventsForDay<T extends { starts_at: string; ends_at: string | null }>(events: T[], date: Date): T[] {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return events.filter((ev) => {
    const { startDay, endDay } = getEventDayBounds(ev);
    return day >= startDay && day <= endDay;
  });
}

/** Stable color pool for auto-created agents — assigns an unused color where
 *  possible, falling back to a random reuse once the pool is exhausted. */
export const AGENT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#ec4899",
];

export function pickAgentColor(existingAgents: { color: string }[]): string {
  const used = new Set(existingAgents.map((a) => a.color));
  const available = AGENT_COLORS.filter((c) => !used.has(c));
  const pool = available.length > 0 ? available : AGENT_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Sunday-start week containing `date`, at local midnight — same derivation as the web calendar's `startOfWeek`. */
export function startOfWeekFor(date: Date): Date {
  const d = new Date(date);
  d.setDate(date.getDate() - date.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The 7 days (Sun..Sat) of the week containing `date`. */
export function getWeekDays(date: Date): Date[] {
  const start = startOfWeekFor(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}
