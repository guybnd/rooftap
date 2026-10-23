'use client';

// FLUX-189: recipes local-first store. Mirrors grocery-items-store.ts / checklists-store.ts.
//
// Usage in a page:
//   const recs$ = recipes$(group?.id);
//   const all = use$(() => Object.values(recs$.get() ?? {})
//     .filter(r => !!r && !r.deleted).sort(...));
//
//   const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(recs$, currentUserId);
//   useReconnectSync(recs$);

import { createGroupStore } from '../create-group-store';
import type { Recipe } from '../../types';
import { normalizeRecipeRow } from '../../modules/recipes/recipes';

export const recipes$ = createGroupStore<Recipe>({
  collection: 'recipes',
  storageName: 'recipes',
  // HOUP-333: every row from Supabase gets a guaranteed `cuisines` array.
  normalizeRow: normalizeRecipeRow,
});
