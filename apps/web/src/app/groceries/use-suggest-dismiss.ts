'use client';

// The X on a "Might be running low" suggestion. The hook lives in core
// (modules/groceries/use-suggest-dismiss.ts); this binds the web settings
// cache and client.
import type { GroceryItem } from '@homeup/core';
import { useSuggestDismiss as useCoreSuggestDismiss } from '@homeup/core';
import { createClient } from '@/lib/supabase/client';
import { useDataCache } from '@/lib/data-cache';

export function useSuggestDismiss(opts: {
  /** "Not now": hide the suggestion for this have-it stint (with its Undo pill). */
  hide: (item: GroceryItem) => void;
  archive: (item: GroceryItem) => void;
}) {
  const { userSettings, refresh } = useDataCache();
  return useCoreSuggestDismiss({ ...opts, stored: userSettings?.grocery_suggest_dismiss, refresh, getClient: createClient });
}
