// The calendar slot's custom parts (.docs/modules.md, section 17). Every
// module's calendar entry draws with the calendar's generic agenda row; a
// module that needs a special look adds its trailing part here, keyed by
// module id. Native twin: apps/mobile/src/features/calendar/entry-rows.tsx.
import type { ReactNode } from "react";
import { binLidsOf, type CalendarEntry } from "@homeup/core";
import { BinLids } from "@/components/bin-lids";

type Trailing = (entry: CalendarEntry, className?: string) => ReactNode;

const TRAILING: Partial<Record<string, Trailing>> = {
  // Bin night: the lid colours collected that day.
  bins: (entry, className) => <BinLids lids={binLidsOf(entry)} className={className} />,
};

/** The entry's module's own trailing part, or nothing. */
export function CalendarEntryTrailing({ entry, className }: { entry: CalendarEntry; className?: string }) {
  return <>{TRAILING[entry.moduleId]?.(entry, className) ?? null}</>;
}
