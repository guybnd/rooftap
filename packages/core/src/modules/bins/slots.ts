'use client';

// Bin night's slots (.docs/modules.md, section 17). The calendar: each
// collection day in range, as an all-day entry that opens Bins. Home: "Bins
// out tonight" on bin night, which sliding marks out. Both carry the lid
// colours (`binLidsOf`), which each app's bins row part draws.

import { useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { binChanges$, binStreams$ } from '../../data/stores';
import { useReconnectSync } from '../../data/create-group-store';
import type { CalendarEntry, CalendarRange, CalendarSource, HomeAgendaSource } from '../../slots/types';
import { binCollections, binNamesPhrase, type BinChange, type BinStream } from './bins';
import { useBins } from './use-bins';

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

/** The lid colours a bins entry or feed item carries in its detail, for the bins row part. */
export function binLidsOf(detail: Readonly<Record<string, unknown>> | undefined): string[] {
  const lids = detail?.lids;
  return Array.isArray(lids) ? lids.filter((l): l is string => typeof l === 'string') : [];
}

/** The collection a bin night feed item marks out. */
function collectionDateOf(detail: Readonly<Record<string, unknown>> | undefined): string | null {
  return typeof detail?.collectionDate === 'string' ? detail.collectionDate : null;
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

export const binsHomeAgendaSource: HomeAgendaSource = {
  moduleId: 'bins',
  feature: 'hub.bins',
  useAgenda({ groupId, currentUserId }) {
    const bins = useBins(groupId, currentUserId);
    const { heroItem, markOut, undoOut } = bins;
    return useMemo(
      () => ({
        items: heroItem ? [heroItem] : [],
        complete: (item) => {
          const date = collectionDateOf(item.module?.detail);
          if (date) markOut(date);
        },
        undo: () => undoOut(),
      }),
      [heroItem, markOut, undoOut],
    );
  },
};
