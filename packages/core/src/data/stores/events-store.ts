'use client';

// FLUX-249 slice: `events` local-first store — group-visible shared calendar
// events. Mirrors household-tasks-store.ts.
//
// Usage in a page:
//   const events$ = groupEvents$(group?.id);
//   const allEvents = useRows(events$); // readable, not deleted, stable
//
//   const { writeRow: writeEvent } = useStoreHelpers(events$, currentUserId);
//   useReconnectSync(events$);

import { createGroupStore } from '../create-group-store';
import type { GroupEvent } from '../../types';

export const groupEvents$ = createGroupStore<GroupEvent>({
  collection: 'events',
  requiredFields: ['title'],
  storageName: 'events',
});
