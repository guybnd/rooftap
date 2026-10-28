'use client';

// Calendar's slots (.docs/modules.md, section 17). Search: the household's
// own events, by title, place and notes. A hit opens the Calendar on the
// event's day. Private events reach only their owner (row level security).

import { useMemo } from 'react';
import { groupEvents$ } from '../../data/stores';
import { toISODate } from '../../date-utils';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useSlotRows } from '../../slots/rows';
import type { SearchSource } from '../../slots/types';
import type { GroupEvent } from '../../types';
import { eventWhenText } from './events';

export function eventsSearchHits(events: readonly GroupEvent[]): GlobalHit[] {
  return events
    .filter((e) => !e.deleted)
    .map((e) => ({
      section: 'events',
      sectionId: 'calendar',
      sectionLabel: 'Calendar',
      id: e.id,
      title: e.title,
      subtitle: eventWhenText(e),
      keywords: [e.location, e.notes].filter(Boolean).join(' '),
      href: `/calendar?date=${toISODate(new Date(e.starts_at))}`,
    }));
}

export const eventsSearchSource: SearchSource = {
  moduleId: 'calendar',
  useHits({ groupId, active }) {
    const events = useSlotRows(groupEvents$, groupId, active);
    return useMemo(() => ({ hits: eventsSearchHits(events) }), [events]);
  },
};
