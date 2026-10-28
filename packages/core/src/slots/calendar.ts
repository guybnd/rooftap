'use client';

// The calendar slot (.docs/modules.md, section 17): every module source that
// puts entries on the calendar, and the hook both calendar screens read. A
// source only shows while its module feature is on; off, it gets no group id
// and its entries are dropped.
//
// The calendar's own items (household events, pulled Google events, to-dos and
// viewings) stay built into the screens: they open in place to edit, drag on
// the hour grid and book from a long-press, which a slot entry doesn't do.

import { useMemo } from 'react';
import { useModules } from '../modules-store';
import { toISODate } from '../date-utils';
import { binsCalendarSource } from '../modules/bins/calendar-source';
import { occasionsCalendarSource } from '../modules/occasions/calendar-source';
// A module's calendar source is imported above this line and listed below.
import type { CalendarEntry, CalendarRange, CalendarSource } from './types';

/** In the order their all-day entries lead a day. Each module listing 'calendar' in its manifest's slots has one. */
export const CALENDAR_SOURCES: readonly CalendarSource[] = [
  binsCalendarSource,
  occasionsCalendarSource,
];

/** The range that covers these days. */
export function calendarRangeOf(days: readonly Date[]): CalendarRange {
  const keys = days.map(toISODate).sort();
  const today = toISODate(new Date());
  return { from: keys[0] ?? today, to: keys[keys.length - 1] ?? today };
}

/** Every switched-on source's entries in range, all-day sources in registry order. */
export function useCalendarEntries(
  groupId: string | undefined,
  currentUserId: string | null | undefined,
  range: CalendarRange,
  sources: readonly CalendarSource[] = CALENDAR_SOURCES,
): CalendarEntry[] {
  const modules = useModules();
  const { from, to } = range;
  const stableRange = useMemo(() => ({ from, to }), [from, to]);
  // The list never changes at run time, so every source's hook runs on every render in the same order.
  const perSource = sources.map((source) => {
    const on = modules.feature(source.feature);
    const entries = source.useEntries({ groupId: on ? groupId : undefined, currentUserId, range: stableRange });
    return on ? entries : null;
  });
  // Each source memoises its own list, so the merged one changes only when one of them does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => perSource.flatMap((e) => e ?? []), perSource);
}

/** One day's entries, in source order. */
export function calendarEntriesOn(entries: readonly CalendarEntry[], day: string): CalendarEntry[] {
  return entries.filter((e) => e.date === day);
}
