'use client';

// FLUX-156: checklists local-first store. Mirrors grocery-items-store.ts.
//
// Usage in a page:
//   const lists$ = checklists$(group?.id);
//   const all = useRows(lists$); // readable, not deleted, stable
//
//   const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(lists$, currentUserId);
//   useReconnectSync(lists$);

import { createGroupStore } from '../create-group-store';
import type { Checklist } from '../../types';

export const checklists$ = createGroupStore<Checklist>({
  collection: 'checklists',
  requiredFields: ['title'],
  storageName: 'checklists',
});
