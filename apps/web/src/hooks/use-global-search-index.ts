'use client';

// HOUP-147: moved to packages/core (shared with apps/mobile). This thin
// wrapper injects web's Supabase client so every existing
// `@/hooks/use-global-search-index` import site keeps working unchanged.

import { createClient } from '@/lib/supabase/client';
import {
  useGlobalSearchIndex as useCoreGlobalSearchIndex,
  type GlobalHit,
  type GlobalHitAction,
  type SectionKey,
} from '@homeup/core/src/hooks/use-global-search-index';

export { resolveGlobalHitAction } from '@homeup/core/src/hooks/use-global-search-index';
export type { GlobalHit, GlobalHitAction, SectionKey };

interface UseGlobalSearchIndexArgs {
  groupId: string;
  hiddenSections: string[];
  /** The search is open; closed, no module's stores are read. */
  active?: boolean;
}

export function useGlobalSearchIndex(args: UseGlobalSearchIndexArgs): { index: GlobalHit[]; docsLoading: boolean } {
  return useCoreGlobalSearchIndex({ ...args, supabase: createClient() });
}
