'use client';

// Saving and deleting a household event together with its Budget line
// (event-budget.ts). Shared by both calendars and both Homes, which edit an
// event in place from its Upcoming row.

import { useCallback } from 'react';
import { use$ } from '@legendapp/state/react';
import type { CostItem, GroupEvent } from '../../types';
import { costItems$, groupEvents$ } from '../../data/stores';
import { useStoreHelpers } from '../../data/create-group-store';
import { envRandomUUID } from '../../data/store-environment';
import { planEventCost } from './event-budget';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** `showBudget` is the 'calendar.budget' module feature: without it, events save alone. */
export function useEventSave(groupId: string | undefined, currentUserId: string | null | undefined, showBudget: boolean) {
  const { writeRow: writeEvent, softDeleteRow: softDeleteEvent } = useStoreHelpers(groupEvents$(groupId), currentUserId);
  const costs$ = costItems$(showBudget ? groupId : undefined);
  const { writeRow: writeCost, patchRow: patchCost, softDeleteRow: deleteCost } = useStoreHelpers(costs$, currentUserId);
  const costs = use$(() => costs$.get() ?? {});

  const linkedCostOf = useCallback(
    (event: GroupEvent | null | undefined): CostItem | null => {
      const cost = event?.cost_item_id ? costs[event.cost_item_id] : undefined;
      return cost && !cost.deleted ? cost : null;
    },
    [costs]
  );

  /** `costCents` is the cost on the form (null = none); the Budget line follows it. */
  const saveEvent = useCallback(
    (saved: GroupEvent, costCents: number | null) => {
      if (!showBudget) {
        writeEvent(saved);
        return;
      }
      const { event: linked, change } = planEventCost({
        event: saved,
        existing: linkedCostOf(saved),
        amountCents: costCents,
        newId: envRandomUUID,
        today: todayKey(),
        createdBy: currentUserId,
      });
      if (change.kind === 'create') writeCost(change.cost);
      else if (change.kind === 'update') patchCost(change.id, change.patch);
      else if (change.kind === 'remove') deleteCost(change.id);
      writeEvent(linked);
    },
    [showBudget, writeEvent, linkedCostOf, currentUserId, writeCost, patchCost, deleteCost]
  );

  /** The event's Budget line goes with it. */
  const deleteEvent = useCallback(
    (event: GroupEvent) => {
      const cost = linkedCostOf(event);
      if (cost) deleteCost(cost.id);
      softDeleteEvent(event.id);
    },
    [linkedCostOf, deleteCost, softDeleteEvent]
  );

  return { linkedCostOf, saveEvent, deleteEvent };
}
