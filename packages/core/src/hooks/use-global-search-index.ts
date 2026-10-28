// FLUX-152 / HOUP-147: global fuzzy search index for the /home hub, shared
// between web (the /home hub + capture sheet) and apps/mobile (the capture
// sheet's search step). Moved from apps/web/src/hooks/use-global-search-index.ts
// to packages/core — its only web-specific binding was constructing a
// Supabase client, replaced below with an injected `supabase` arg so callers
// on either platform pass their own client. Web now re-exports this via a
// thin shim at its old import path.
//
// Builds a flat list of GlobalHit (one per searchable item across all sections)
// from all available section data. The caller feeds it through useFuzzySearch
// (fuse.js) and groups the results by section for display.
//
// Each module's rows come from its own search source (core slots/search.ts,
// the module's slots.ts), which reads its stores while the search is open.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Document } from '../types';
import { useSearchHits } from '../slots/search';

/**
 * The search domain's keys for the sections first-party modules fill. A
 * module's search source may add its own key; GlobalHit.section is a plain
 * string so it can.
 */
export type SectionKey =
  | 'tasks'
  | 'groceries'
  | 'costs'
  | 'setup'
  | 'calendar'
  | 'checklist'
  | 'search'
  | 'documents'
  | 'recipes'
  | 'shopper'
  | 'checklists';

export interface GlobalHit {
  /** The search domain's key (SectionKey for first-party modules): what a row looks like, and whether it opens an editor. */
  section: string;
  /** The sections.ts id whose tile and hue the row wears. */
  sectionId: string;
  /** The results group's heading. */
  sectionLabel: string;
  id: string;
  title: string;
  subtitle?: string;
  /** Concatenated searchable fields beyond title/subtitle. */
  keywords: string;
  /** Where the hit goes, for a section that doesn't open an editor in place. */
  href?: string;
}

/** The action a hit resolves to when tapped/clicked — the single source of the nav-vs-modal decision. */
export type GlobalHitAction =
  | { kind: 'nav'; href: string }
  | { kind: 'modal'; section: string; id: string };

/** Sections whose hits open their editor in the capture sheet instead of navigating. */
const MODAL_SECTIONS = new Set<string>(['tasks', 'groceries', 'costs']);

/**
 * Resolves what should happen when a GlobalHit is activated. Tasks/groceries/
 * costs open their native edit modal; every other section navigates to the
 * hit's own href (Home when a source left it out).
 */
export function resolveGlobalHitAction(hit: GlobalHit): GlobalHitAction {
  if (MODAL_SECTIONS.has(hit.section)) {
    return { kind: 'modal', section: hit.section, id: hit.id };
  }
  return { kind: 'nav', href: hit.href ?? '/home' };
}

interface UseGlobalSearchIndexArgs {
  supabase: SupabaseClient | null;
  /** Empty while the search is closed or there is no household: nothing is fetched. */
  groupId: string | null | undefined;
  hiddenSections: string[];
  /** The search is open; closed, the stores aren't read. Defaults to open. */
  active?: boolean;
  /** Optional synced document rows (the phone's store) in place of a fresh fetch. */
  documentStoreRows?: Document[];
}

/** The global search index: every module's search source (core slots/search.ts), merged. */
export function useGlobalSearchIndex(args: UseGlobalSearchIndexArgs): { index: GlobalHit[]; docsLoading: boolean } {
  return useSearchHits(args);
}
