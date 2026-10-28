// What a module hands a shared screen (.docs/modules.md, section 17). Each
// slot is a contract: the shape of one entry, and a source the module keeps
// in its own folder. The shared screen loops over every source and draws the
// entries with one generic Hearth row, so a module shows up there without an
// edit to the screen.
//
// Types only, so a module's source can import them without pulling in the
// slot registries that list the sources.

import type { ModuleFeatureId } from '../module-features';

/** The days a calendar screen has on view, as YYYY-MM-DD, both ends included. */
export interface CalendarRange {
  from: string;
  to: string;
}

/** One thing a module puts on the calendar. */
export interface CalendarEntry {
  /** Unique across every source: prefix it with the module id. */
  key: string;
  /** The module it comes from: its section's tile, glyph and hue. */
  moduleId: string;
  /** YYYY-MM-DD. */
  date: string;
  /** A wall-clock "HH:MM", or null for an all-day entry. */
  time: string | null;
  /** The agenda row's title. */
  title: string;
  /** The agenda row's meta line after the time. */
  subtitle?: string;
  /** The week grid's all-day chip, when shorter than the title says it better ("Bins: red and green"). */
  chipTitle?: string;
  /** Where a tap goes: the module's own screen. */
  href: string;
  /**
   * Data a module's own row reads (bin lid colours). Only a module that
   * registers a custom row per app sets it; the generic row ignores it.
   */
  detail?: Readonly<Record<string, unknown>>;
}

export interface CalendarSourceContext {
  /** undefined while the source's feature is off: open the inert stores and return nothing. */
  groupId: string | undefined;
  currentUserId: string | null | undefined;
  range: CalendarRange;
}

/** A module's calendar source, kept in its folder as calendar-source.ts. */
export interface CalendarSource {
  moduleId: string;
  /** The module feature that gates it, naming calendar and the module (module-features.ts). */
  feature: ModuleFeatureId;
  /** A React hook, called on every render in a fixed order. */
  useEntries(ctx: CalendarSourceContext): CalendarEntry[];
}
