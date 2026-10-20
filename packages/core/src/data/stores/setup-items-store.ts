'use client';

// FLUX-150 slice 3: setup_items local-first store.
//
// Schema prerequisites (migration 20260618000002):
//   - deleted boolean NOT NULL DEFAULT false
//   - handle_times() BEFORE INSERT OR UPDATE trigger
//   - INDEX (group_id, updated_at) for changesSince incremental pulls
//
// Usage in a page:
//   const items$ = setupItems$(group?.id);
//   const allItems = use$(() => Object.values(items$.get() ?? {})
//     .filter(i => !!i && !i.deleted).sort(...));
//
//   const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(items$, currentUserId);
//   useReconnectSync(items$);
//
// Sort order / DnD: patchRow(id, { sort_order: newIndex }) for each reordered
// item — Legend queues the Supabase updates and retries offline.

import { createGroupStore } from '../create-group-store';
import type { SetupItem } from '../../types';

export const setupItems$ = createGroupStore<SetupItem>({
  collection: 'setup_items',
  storageName: 'setup_items',
});
