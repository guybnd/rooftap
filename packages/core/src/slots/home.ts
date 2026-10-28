'use client';

// The Home agenda slot (.docs/modules.md, section 17): every module source
// that adds items to Home's feed and Now card, and the hook both Home screens
// read. A source shows while its hub feature is on and its section isn't
// hidden; off, it gets no group id and its items are dropped.
//
// Home's own sources (tasks and reminders, viewings, household and Google
// events) stay in buildHeroItems: they edit in place, and hero.ts already
// gates each one.

import { useCallback, useMemo } from 'react';
import { useModules } from '../modules-store';
import type { HeroItem } from '../hero';
import { binsHomeAgendaSource } from '../modules/bins/slots';
// A module's Home agenda source is imported above this line and listed below.
import type { HomeAgendaPart, HomeAgendaSource } from './types';

/** In the order their items join the feed. Each module listing 'home-agenda' in its manifest's slots has one. */
export const HOME_AGENDA_SOURCES: readonly HomeAgendaSource[] = [binsHomeAgendaSource];

export interface HomeAgenda {
  /** Every shown source's items, for buildHeroItems' extraItems. */
  items: HeroItem[];
  /** Whether sliding this item finishes it through its module. */
  canComplete: (item: HeroItem) => boolean;
  /** Finish a module item through its source. */
  complete: (item: HeroItem) => void;
  /** Take a module item's finish back through its source. */
  undo: (item: HeroItem) => void;
}

/**
 * Every switched-on source's items, with finish and undo routed to the
 * module each item came from. `hidden` is the person's hidden sections
 * (hiddenWithDisabledModules): a hidden module's items stay off Home.
 */
export function useHomeAgenda(
  groupId: string | undefined,
  currentUserId: string | null | undefined,
  hidden: readonly string[],
  sources: readonly HomeAgendaSource[] = HOME_AGENDA_SOURCES,
): HomeAgenda {
  const modules = useModules();
  // The list never changes at run time, so every source's hook runs on every render in the same order.
  const parts = sources.map((source): [string, HomeAgendaPart | null] => {
    const on = modules.feature(source.feature) && !hidden.includes(source.moduleId);
    const part = source.useAgenda({ groupId: on ? groupId : undefined, currentUserId });
    return [source.moduleId, on ? part : null];
  });
  // Each source memoises its own part, so the merged agenda changes only when one of them does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const byModule = useMemo(() => new Map(parts.filter((p): p is [string, HomeAgendaPart] => !!p[1])), parts.map((p) => p[1]));
  const items = useMemo(() => [...byModule.values()].flatMap((p) => p.items), [byModule]);
  const partOf = useCallback((item: HeroItem) => (item.module ? byModule.get(item.module.id) : undefined), [byModule]);
  const canComplete = useCallback((item: HeroItem) => !!item.module?.completable && !!partOf(item)?.complete, [partOf]);
  const complete = useCallback((item: HeroItem) => partOf(item)?.complete?.(item), [partOf]);
  const undo = useCallback((item: HeroItem) => partOf(item)?.undo?.(item), [partOf]);
  return useMemo(() => ({ items, canComplete, complete, undo }), [items, canComplete, complete, undo]);
}
