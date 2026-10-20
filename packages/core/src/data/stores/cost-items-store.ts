'use client';

// FLUX-150 slice 2: cost_items local-first store.
//
// Schema prerequisites (migration 20260618000002):
//   - deleted boolean NOT NULL DEFAULT false
//   - handle_times() BEFORE INSERT OR UPDATE trigger
//   - INDEX (group_id, updated_at) for changesSince incremental pulls
//
// Usage in a page:
//   const items$ = costItems$(group?.id);
//   const allItems = use$(() => Object.values(items$.get() ?? {})
//     .filter(i => !!i && !i.deleted).sort(...));
//
//   const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(items$, currentUserId);
//   useReconnectSync(items$);

import { createGroupStore } from '../create-group-store';
import type { CostItem } from '../../types';

export const costItems$ = createGroupStore<CostItem>({
  collection: 'cost_items',
  storageName: 'cost_items',
});
