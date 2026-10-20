'use client';

// FLUX-249 slice: `events` local-first store — group-visible shared calendar
// events. Mirrors household-tasks-store.ts.
//
// Usage in a page:
//   const events$ = groupEvents$(group?.id);
//   const allEvents = use$(() => Object.values(events$.get() ?? {})
//     .filter(e => !!e && !e.deleted));
//
//   const { writeRow: writeEvent } = useStoreHelpers(events$, currentUserId);
//   useReconnectSync(events$);

import { createGroupStore } from '../create-group-store';
import type { GroupEvent } from '../../types';

export const groupEvents$ = createGroupStore<GroupEvent>({
  collection: 'events',
  storageName: 'events',
});
