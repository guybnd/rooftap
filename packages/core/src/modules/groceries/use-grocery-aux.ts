'use client';

// The extra data a grocery card needs beyond the item itself: the group's
// custom aisles (the card's aisle picker and accent colours) and the shared
// item library (learned prices and shelf lives). Neither is offline-synced;
// offline, cards fall back to code-default aisles and prices. Each app passes
// its own Supabase client getter.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GroceryCustomAisle } from '../../types';
import { buildLibraryMap, fetchItemLibrary, resolveItemDefaults, type LibraryOverride } from './item-library';

export interface GroceryAux {
  /** Custom aisles for the group, in their sort order. */
  customAisles: GroceryCustomAisle[];
  /** The item library rows. */
  library: LibraryOverride[];
  /** Normalised name to library override. */
  libMap: Map<string, LibraryOverride>;
  /** Typical price (cents) for an item name, from the library or code defaults. */
  priceFor: (name: string) => number | null;
  /** Fetch both again, e.g. after the library learned a price. */
  refresh: () => void;
}

/** `getClient` must be stable (a module function), or the fetch reruns each render. */
export function useGroceryAux(groupId: string | null | undefined, getClient: () => SupabaseClient): GroceryAux {
  const [customAisles, setCustomAisles] = useState<GroceryCustomAisle[]>([]);
  const [library, setLibrary] = useState<LibraryOverride[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getClient();
        const [aislesRes, libraryRows] = await Promise.all([
          supabase.from('grocery_aisles').select('*').eq('group_id', groupId).order('sort_order', { ascending: true }),
          fetchItemLibrary(supabase, groupId),
        ]);
        if (cancelled) return;
        setCustomAisles((aislesRes.data ?? []) as GroceryCustomAisle[]);
        setLibrary(libraryRows);
      } catch {
        // Offline, or the client isn't bound yet: the caller still renders
        // with code-default aisles and prices.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, nonce, getClient]);

  const libMap = useMemo(() => buildLibraryMap(library), [library]);
  const priceFor = useCallback((name: string) => resolveItemDefaults(name, libMap).priceCents, [libMap]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return useMemo(
    () => ({ customAisles, library, libMap, priceFor, refresh }),
    [customAisles, library, libMap, priceFor, refresh]
  );
}
