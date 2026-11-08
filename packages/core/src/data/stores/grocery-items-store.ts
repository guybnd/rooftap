'use client';

// FLUX-149 (pilot) → FLUX-150 (refactored to shared factory).
//
// Usage in a page:
//   const items$ = groceryItems$(group?.id);
//   const allItems = useRows(items$); // readable, not deleted, stable
//
//   const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(items$, currentUserId);
//   useReconnectSync(items$);

import { createGroupStore } from '../create-group-store';
import type { GroceryItem } from '../../types';

export const groceryItems$ = createGroupStore<GroceryItem>({
  collection: 'grocery_items',
  requiredFields: ['name'],
  storageName: 'grocery_items',
});
