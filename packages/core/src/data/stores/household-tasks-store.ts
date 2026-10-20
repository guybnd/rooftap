'use client';

// FLUX-150 slice 1: household_tasks local-first store.
//
// Schema prerequisites (already shipped in FLUX-148):
//   - created_at / updated_at timestamptz with handle_times() BEFORE INSERT OR UPDATE trigger
//   - deleted boolean NOT NULL DEFAULT false
//   - INDEX (group_id, updated_at) for changesSince incremental pulls
//
// Usage in a page:
//   const tasks$ = householdTasks$(group?.id);
//   const allTasks = use$(() => Object.values(tasks$.get() ?? {})
//     .filter(t => !!t && !t.deleted).sort(...));
//
//   const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(tasks$, currentUserId);
//   useReconnectSync(tasks$);
//
// Recurrence note: when completing a recurring task, the page generates a new
// task via nextOccurrenceISO and calls writeRow() with the new task object.
// writeRow() sets created_at: null so Legend classifies it as INSERT — same
// pattern as groceries. Don't pass a real timestamp or it silently no-ops.

import { createGroupStore } from '../create-group-store';
import type { HouseholdTask } from '../../types';

export const householdTasks$ = createGroupStore<HouseholdTask>({
  collection: 'household_tasks',
  storageName: 'household_tasks',
});
