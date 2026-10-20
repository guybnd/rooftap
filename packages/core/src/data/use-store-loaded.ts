'use client';

import { use$ } from '@legendapp/state/react';
import { syncState, type Observable } from '@legendapp/state';

/**
 * Replaces the ~14 duplicated `cacheLoading || (!storeLoaded && items.length === 0)`
 * guards with one hook. Accepts every Legend store a page reads from — a page is
 * "loaded" only once all of them have resolved their initial sync.
 */
export function useStoreLoaded(...stores: Observable[]): boolean {
  return use$(() => stores.every((store) => syncState(store).isLoaded.get()));
}
