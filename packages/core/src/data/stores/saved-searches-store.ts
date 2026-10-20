'use client';

// FLUX-150 slice 4: saved_searches local-first store. Mirrors recipes-store.ts.

import { createGroupStore } from '../create-group-store';
import type { SavedSearch } from '../../types';

export const savedSearches$ = createGroupStore<SavedSearch>({
  collection: 'saved_searches',
  storageName: 'saved_searches',
});
