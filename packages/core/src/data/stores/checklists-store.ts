'use client';

// FLUX-156: checklists local-first store. Mirrors grocery-items-store.ts.
//
// Usage in a page:
//   const lists$ = checklists$(group?.id);
//   const all = use$(() => Object.values(lists$.get() ?? {})
//     .filter(c => !!c && !c.deleted).sort(...));
//
//   const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(lists$, currentUserId);
//   useReconnectSync(lists$);

import { createGroupStore } from '../create-group-store';
import type { Checklist } from '../../types';

export const checklists$ = createGroupStore<Checklist>({
  collection: 'checklists',
  storageName: 'checklists',
});
