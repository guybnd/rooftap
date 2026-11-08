'use client';

// A module helper's brief on the device (module-helpers.ts), whichever helper
// the chat belongs to. Each helper's hook runs every time, opening its stores
// only for its own helper, so the hook order never changes.

import { useRef } from 'react';
import { todayISO } from './date-utils';
import { showsBrief, type HelperBriefState } from './module-helpers';
import { useModules } from './modules-store';
import { useGroceriesHelper } from './modules/groceries/use-groceries-helper';
import { useDinnersHelper, useGiftsHelper, useMoneyHelper, useWeekHelper } from './use-module-briefs';

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
  const own = (id: string) => (input.helper === id ? input.groupId : undefined);
  const money = useMoneyHelper({ groupId: own('costs'), currentUserId: input.currentUserId, today });
  const week = useWeekHelper({ groupId: own('household'), currentUserId: input.currentUserId, today });
  const dinners = useDinnersHelper({ groupId: modules.isEnabled('meals') ? own('recipes') : undefined, currentUserId: input.currentUserId, today });
  const gifts = useGiftsHelper({ groupId: own('occasions'), currentUserId: input.currentUserId, today });
  switch (input.helper) {
    case 'groceries':
      return groceries;
    case 'costs':
      return money;
    case 'household':
      return week;
    case 'recipes':
      return dinners;
    case 'occasions':
      return gifts;
    default:
      return null;
  }
}

/** Messages this close before the chat opened still count as this visit's (server and device clocks differ). */
const VISIT_SLACK_MS = 2 * 60 * 1000;

/**
 * Where a helper chat shows its brief, as the index of the message it goes
 * before: ahead of the first message of this visit, so it stays above the
 * asks it led to (a Catch me up and its answer). It shows when the chat had
 * nothing before this visit or was quiet for a while (showsBrief); a chat
 * picked up mid-conversation gets none. Null for no brief, or no helper.
 */
export function useBriefSlot(helper: string | null | undefined, messages: readonly { created_at: string }[]): number | null {
  const opened = useRef<{ helper: string | null | undefined; at: number }>({ helper, at: Date.now() });
  if (opened.current.helper !== helper) opened.current = { helper, at: Date.now() };
  const openedAt = { current: opened.current.at };
  if (!helper) return null;
  const visitStart = openedAt.current - VISIT_SLACK_MS;
  let before = 0;
  while (before < messages.length && Date.parse(messages[before].created_at) < visitStart) before++;
  const lastAt = before > 0 ? messages[before - 1].created_at : null;
  return showsBrief(lastAt, openedAt.current) ? before : null;
}
