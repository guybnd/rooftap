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
import type { HouseholdTask, GroceryItem, CostItem, SetupItem, Appointment, ChecklistItem, Recipe, Checklist, ShopperWant } from '@homeup/core';

export { SECTION_LABELS, GLOBAL_HIT_SECTION_ID, resolveGlobalHitAction } from '@homeup/core/src/hooks/use-global-search-index';
export type { GlobalHit, GlobalHitAction, SectionKey };

interface UseGlobalSearchIndexArgs {
  groupId: string;
  hiddenSections: string[];
  tasks: HouseholdTask[];
  groceries: GroceryItem[];
  costItems: CostItem[];
  setupItems: SetupItem[];
  appointments: Appointment[];
  apartments: { id: string; address: string; suburb?: string | null; main_location?: string | null; notes?: string | null }[];
  checklistItems: ChecklistItem[];
  recipes: Recipe[];
  checklists: Checklist[];
  shopperWants?: ShopperWant[];
}

export function useGlobalSearchIndex(args: UseGlobalSearchIndexArgs): { index: GlobalHit[]; docsLoading: boolean } {
  return useCoreGlobalSearchIndex({ ...args, supabase: createClient() });
}
