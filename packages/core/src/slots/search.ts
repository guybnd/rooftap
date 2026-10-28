'use client';

// The search slot (.docs/modules.md, section 17): every module source that
// adds rows to the global search (both apps' capture sheets), and the hook
// that merges them. A source shows while its module is on and not hidden;
// otherwise it gets no group id and its rows are dropped.

import { useMemo } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Document } from '../types';
import { tasksSearchSource } from '../modules/household/slots';
import { groceriesSearchSource } from '../modules/groceries/slots';
import { costsSearchSource } from '../modules/costs/slots';
import { setupSearchSource } from '../modules/setup/slots';
import { homeSearchSearchSource } from '../modules/search/slots';
import { documentsSearchSource } from '../modules/documents/slots';
import { recipesSearchSource } from '../modules/recipes/slots';
import { shopperSearchSource } from '../modules/shopper/slots';
import { checklistsSearchSource } from '../modules/checklists/slots';
import { eventsSearchSource } from '../modules/calendar/slots';
import { occasionsSearchSource } from '../modules/occasions/slots';
import { rewardsSearchSource } from '../modules/rewards/slots';
// new-module:search-source-import (a module's search source is imported above this line and listed below)
import type { GlobalHit } from '../hooks/use-global-search-index';
import type { SearchPart, SearchSource } from './types';

/** In the order their rows join the index. Each module listing 'search' in its manifest's slots has one. */
export const SEARCH_SOURCES: readonly SearchSource[] = [
  tasksSearchSource,
  groceriesSearchSource,
  costsSearchSource,
  setupSearchSource,
  homeSearchSearchSource,
  documentsSearchSource,
  recipesSearchSource,
  shopperSearchSource,
  checklistsSearchSource,
  eventsSearchSource,
  occasionsSearchSource,
  rewardsSearchSource,
  // new-module:search-source (new modules' sources go above this line)
];

export interface SearchHitsInput {
  supabase: SupabaseClient | null;
  /** Empty or undefined: no household yet, nothing is read. */
  groupId: string | null | undefined;
  /** The person's hidden sections with switched-off modules (hiddenWithDisabledModules). */
  hiddenSections: readonly string[];
  /** The search surface is open; closed, nothing is read or fetched. Defaults to open. */
  active?: boolean;
  documentStoreRows?: Document[];
}

/** Every shown source's rows, in registry order. */
export function useSearchHits(input: SearchHitsInput, sources: readonly SearchSource[] = SEARCH_SOURCES): { index: GlobalHit[]; docsLoading: boolean } {
  const { supabase, hiddenSections, documentStoreRows } = input;
  const groupId = input.groupId || undefined;
  const active = input.active ?? true;
  // The list never changes at run time, so every source's hook runs on every render in the same order.
  const parts = sources.map((source): SearchPart | null => {
    const on = !hiddenSections.includes(source.moduleId);
    const part = source.useHits({ groupId: on ? groupId : undefined, active, supabase, documentStoreRows });
    return on ? part : null;
  });
  // Each source memoises its own part, so the merged index changes only when one of them does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(
    () => ({ index: parts.flatMap((p) => p?.hits ?? []), docsLoading: parts.some((p) => !!p?.loading) }),
    parts,
  );
}
