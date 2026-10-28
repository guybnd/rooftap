'use client';

// Bin night's calendar slot: each collection day in range, as an all-day
// entry that opens Bins. Its rows carry the lid colours (`binLidsOf`), which
// each app's bins row draws.

import { useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { binChanges$, binStreams$ } from '../../data/stores';
import { useReconnectSync } from '../../data/create-group-store';
import type { CalendarEntry, CalendarRange, CalendarSource } from '../../slots/types';
import { binCollections, binNamesPhrase, type BinChange, type BinStream } from './bins';

function live<T extends { deleted: boolean }>(record: Record<string, T | undefined> | undefined): T[] {
  return Object.values(record ?? {}).filter((r): r is T => !!r && !r.deleted);
}

/** The collection days in range as calendar entries. */
export function binsCalendarEntries(
  streams: readonly BinStream[],
  changes: readonly BinChange[],
  range: CalendarRange,
): CalendarEntry[] {
  if (streams.length === 0) return [];
  return binCollections(streams, changes, range.from, range.to).map((c) => {
    const names = binNamesPhrase(c.streams);
    return {
      key: `bins-${c.date}`,
      moduleId: 'bins',
      date: c.date,
      time: null,
      title: 'Bin collection',
      subtitle: names,
      chipTitle: `Bins: ${names.toLowerCase()}`,
      href: '/bins',
      detail: { lids: c.streams.map((s) => s.lid) },
    };
  });
}

/** The lid colours a bins entry carries, for the bins row. */
export function binLidsOf(entry: CalendarEntry): string[] {
  const lids = entry.detail?.lids;
  return Array.isArray(lids) ? lids.filter((l): l is string => typeof l === 'string') : [];
}

export const binsCalendarSource: CalendarSource = {
  moduleId: 'bins',
  feature: 'calendar.bins',
  useEntries({ groupId, range }) {
    const streams$ = binStreams$(groupId);
    const changes$ = binChanges$(groupId);
    useReconnectSync(streams$);
    useReconnectSync(changes$);
    const streams = use$(() => live(streams$.get()));
    const changes = use$(() => live(changes$.get()));
    return useMemo(() => binsCalendarEntries(streams, changes, range), [streams, changes, range]);
  },
};
