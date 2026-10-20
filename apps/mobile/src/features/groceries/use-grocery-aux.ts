// HOUP-80: native port of apps/web/src/app/groceries/use-grocery-aux.ts —
// fetches the group's custom aisles + item-library overrides so the card and
// screens can resolve aisle colors/prices without a Legend store (this data
// isn't offline-synced, same as web).
import { useEffect, useState, useMemo, useCallback } from 'react';
import type { GroceryCustomAisle, LibraryOverride } from '@homeup/core';
import { fetchItemLibrary, buildLibraryMap, resolveItemDefaults } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';

export interface GroceryAux {
  customAisles: GroceryCustomAisle[];
  library: LibraryOverride[];
  libMap: Map<string, LibraryOverride>;
  priceFor: (name: string) => number | null;
  refresh: () => void;
}

export function useGroceryAux(groupId: string | null | undefined): GroceryAux {
  const [customAisles, setCustomAisles] = useState<GroceryCustomAisle[]>([]);
  const [library, setLibrary] = useState<LibraryOverride[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getCurrentSupabaseClient();
        const [aislesRes, libraryRows] = await Promise.all([
          supabase.from('grocery_aisles').select('*').eq('group_id', groupId).order('sort_order', { ascending: true }),
          fetchItemLibrary(supabase, groupId),
        ]);
        if (cancelled) return;
        setCustomAisles((aislesRes.data ?? []) as GroceryCustomAisle[]);
        setLibrary(libraryRows);
      } catch {
        // Offline, or the client isn't bound yet — the caller still renders
        // with code-default aisles/prices.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, nonce]);

  const libMap = useMemo(() => buildLibraryMap(library), [library]);
  const priceFor = useCallback((name: string) => resolveItemDefaults(name, libMap).priceCents, [libMap]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { customAisles, library, libMap, priceFor, refresh };
}
