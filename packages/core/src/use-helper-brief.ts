'use client';

// A module helper's brief on the device (module-helpers.ts), whichever helper
// the chat belongs to. Each helper's hook runs every time, opening its stores
// only for its own helper, so the hook order never changes.

import { todayISO } from './date-utils';
import { useModules } from './modules-store';
import { useGroceriesHelper, type HelperBriefState } from './modules/groceries/use-groceries-helper';

export function useHelperBrief(input: {
  helper: string | null | undefined;
  groupId: string | null | undefined;
  currentUserId: string | null | undefined;
}): HelperBriefState | null {
  const modules = useModules();
  const today = todayISO();
  const groceries = useGroceriesHelper({
    groupId: input.helper === 'groceries' ? input.groupId : undefined,
    currentUserId: input.currentUserId,
    today,
    mealsLinked: modules.feature('meals.groceries'),
  });
  if (input.helper === 'groceries') return groceries;
  return null;
}
