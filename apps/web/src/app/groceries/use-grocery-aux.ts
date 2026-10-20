'use client';

// FLUX-191: shared "grocery aux data" hook. The full GroceryItemCard needs a
// few extra props beyond the item itself — the group's custom aisles and the
// shared item-library price map. On the /groceries page these are fetched ad-hoc
// inside `fetchItems`; this hook packages that same fetch so the Home hub widget
// and global search can feed the card identically without duplicating the logic.

import { useEffect, useState, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { GroceryCustomAisle } from '@homeup/core';
import { fetchItemLibrary, buildLibraryMap, resolveItemDefaults, type LibraryOverride } from '@homeup/core';

export interface GroceryAux {
  /** Custom aisles for the group (feeds the card's aisle picker + accent colors). */
  customAisles: GroceryCustomAisle[];
  /** Normalised name → library override map. */
  libMap: Map<string, LibraryOverride>;
  /** Typical price (cents) for an item name, from the library or code defaults. */
  priceFor: (name: string) => number | null;
}

export function useGroceryAux(groupId: string | null | undefined): GroceryAux {
  const [customAisles, setCustomAisles] = useState<GroceryCustomAisle[]>([]);
  const [library, setLibrary] = useState<LibraryOverride[]>([]);

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const [aislesRes, libraryRows] = await Promise.all([
          supabase
            .from('grocery_aisles')
            .select('*')
            .eq('group_id', groupId)
            .order('sort_order', { ascending: true }),
          fetchItemLibrary(supabase, groupId),
        ]);
        if (cancelled) return;
        setCustomAisles((aislesRes.data ?? []) as GroceryCustomAisle[]);
        setLibrary(libraryRows);
      } catch {
        /* offline — the card still renders with code-default aisles/prices */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const libMap = useMemo(() => buildLibraryMap(library), [library]);
  const priceFor = useCallback(
    (name: string) => resolveItemDefaults(name, libMap).priceCents,
    [libMap]
  );

  return { customAisles, libMap, priceFor };
}
