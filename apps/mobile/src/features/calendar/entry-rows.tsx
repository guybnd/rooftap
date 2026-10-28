// The calendar slot's custom parts (.docs/modules.md, section 17). Every
// module's calendar entry draws with the agenda's generic row; a module that
// needs a special look adds its trailing part here, keyed by module id.
// Web twin: apps/web/src/components/calendar-entry-rows.tsx.
import * as React from 'react';
import { binLidsOf, type CalendarEntry } from '@homeup/core';
import { BinLids } from '@/features/bins/bin-lids';

type Trailing = (entry: CalendarEntry) => React.ReactNode;

const TRAILING: Partial<Record<string, Trailing>> = {
  // Bin night: the lid colours collected that day.
  bins: (entry) => <BinLids lids={binLidsOf(entry)} size="sm" />,
};

/** The entry's module's own trailing part, or nothing. */
export function CalendarEntryTrailing({ entry }: { entry: CalendarEntry }) {
  return <>{TRAILING[entry.moduleId]?.(entry) ?? null}</>;
}
