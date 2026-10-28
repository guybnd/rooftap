'use client';

// Occasions' calendar slot: birthdays and other days that fall in range and
// show on the Calendar, as all-day entries that open Occasions.

import { useMemo } from 'react';
import { addDaysISO } from '../../date-utils';
import type { CalendarEntry, CalendarRange, CalendarSource } from '../../slots/types';
import { occasionKindLabel, occasionTitle, occasionsOnDay, type Occasion } from './occasions';
import { useOccasionDays } from './use-occasions';

/** The occasions in range as calendar entries, titled for this person ("Your birthday"). */
export function occasionsCalendarEntries(
  occasions: readonly Occasion[],
  me: string | null,
  range: CalendarRange,
): CalendarEntry[] {
  if (occasions.length === 0) return [];
  const titled = occasions.map((o) => ({ ...o, title: occasionTitle(o, me) }));
  const entries: CalendarEntry[] = [];
  for (let day = range.from; day <= range.to; day = addDaysISO(day, 1)) {
    for (const o of occasionsOnDay(titled, day)) {
      entries.push({
        key: `occasion-${o.id}-${day}`,
        moduleId: 'occasions',
        date: day,
        time: null,
        title: o.title,
        subtitle: occasionKindLabel(o.kind),
        href: '/occasions',
      });
    }
  }
  return entries;
}

export const occasionsCalendarSource: CalendarSource = {
  moduleId: 'occasions',
  feature: 'calendar.occasions',
  useEntries({ groupId, currentUserId, range }) {
    const occasions = useOccasionDays(groupId);
    return useMemo(() => occasionsCalendarEntries(occasions, currentUserId ?? null, range), [occasions, currentUserId, range]);
  },
};
