'use client';

// Occasions' slots (.docs/modules.md, section 17). Calendar: birthdays and
// other days in range, as all-day entries that open Occasions. Home agenda:
// the same days in Home's feed and Now card. An occasion switched off the
// Calendar stays off Home too. Search: every occasion, by title.

import { useMemo } from 'react';
import { addDaysISO } from '../../date-utils';
import { todayISO } from '../../date-utils';
import type { HeroItem } from '../../hero';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useSlotRows } from '../../slots/rows';
import { occasions$ } from '../../data/stores';
import type { CalendarEntry, CalendarRange, CalendarSource, HomeAgendaSource, SearchSource } from '../../slots/types';
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

/** How far ahead Home's agenda source looks. Home's own range picks from these. */
export const OCCASIONS_HOME_DAYS = 62;

/** The occasions from today on as Home feed items: all day, opening Occasions, nothing to tick. */
export function occasionsHomeAgendaItems(
  occasions: readonly Occasion[],
  me: string | null,
  today: string,
  days = OCCASIONS_HOME_DAYS,
): HeroItem[] {
  return occasionsCalendarEntries(occasions, me, { from: today, to: addDaysISO(today, days - 1) }).map((e) => ({
    id: e.key,
    type: 'module',
    ownerSection: 'occasions',
    title: e.title,
    dueDate: e.date,
    dueTime: null,
    overdue: false,
    done: false,
    assignedTo: null,
    sourceLabel: e.subtitle ?? '',
    module: { id: 'occasions', href: e.href, completable: false },
  }));
}

export const occasionsHomeAgendaSource: HomeAgendaSource = {
  moduleId: 'occasions',
  feature: 'hub.occasions',
  useAgenda({ groupId, currentUserId }) {
    const occasions = useOccasionDays(groupId);
    const today = todayISO();
    return useMemo(() => ({ items: occasionsHomeAgendaItems(occasions, currentUserId ?? null, today) }), [occasions, currentUserId, today]);
  },
};

export function occasionsSearchHits(occasions: readonly Occasion[]): GlobalHit[] {
  return occasions
    .filter((o) => !o.deleted)
    .map((o) => ({
      section: 'occasions',
      sectionId: 'occasions',
      sectionLabel: 'Occasions',
      id: o.id,
      title: o.title,
      subtitle: occasionKindLabel(o.kind),
      keywords: '',
      href: '/occasions',
    }));
}

export const occasionsSearchSource: SearchSource = {
  moduleId: 'occasions',
  useHits({ groupId, active }) {
    const occasions = useSlotRows(occasions$, groupId, active);
    return useMemo(() => ({ hits: occasionsSearchHits(occasions) }), [occasions]);
  },
};
