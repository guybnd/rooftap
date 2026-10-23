import { use$ } from '@legendapp/state/react';
import { householdTasks$ } from '../data/stores';
import { bucketTasksByDueDate } from '../modules/household/household-tasks';
import { useModules } from '../modules-store';
import { isTaskOwnerEnabled } from '../task-modules';
import { syncedGroupId } from '../store-modules';
import type { HouseholdTask } from '../types';

// HOUP-142: native counterpart of apps/web/src/hooks/use-overdue-task-count.ts.
// Web recounts via a dedicated Supabase query (it has no local-first store);
// native already syncs household_tasks into the Legend store the Tasks screen
// itself reads (HOUP-73), so this derives the same count straight from that
// store instead of a second, redundant query path — stays correct offline and
// updates the instant householdTasks$ changes, no separate realtime channel.
export function useOverdueTaskCount(groupId: string | undefined | null): number {
  // Modules: a bill or document reminder counts only while its owning module
  // is on (task-modules.ts), and with none of them on the table doesn't sync.
  const { enabled } = useModules();
  const tasks$ = householdTasks$(syncedGroupId(householdTasks$, groupId, enabled));
  const tasks = use$(() => Object.values(tasks$.get() ?? {}).filter((t): t is HouseholdTask => !!t && !t.deleted));
  return bucketTasksByDueDate(tasks.filter((t) => isTaskOwnerEnabled(t, enabled))).overdue.length;
}
