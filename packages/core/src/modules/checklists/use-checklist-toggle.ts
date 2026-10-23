'use client';

// FLUX-1558/HOUP-79: shared tick/untick logic for a checklist item — cost-logging
// (Shopping) + completion sync to the linked dashboard to-do/checklist. Promoted
// from apps/web/src/lib/legend/use-checklist-toggle.ts (its own header cited this
// as "the plan's flagged top risk") into @homeup/core so the web checklist detail
// page, the /tasks inline panel, AND the native checklist detail screen can never
// fork this behavior.

import { useCallback } from 'react';
import type { Checklist, ChecklistTaskItem } from '../../types';
import { checklists$, checklistItems$, householdTasks$, costItems$ } from '../../data/stores';
import { useStoreHelpers } from '../../data/create-group-store';
import { checkItemPatch, uncheckItemPatch, buildLoggedCost, completion, liveItems } from './checklists';
import { getEnabledModules } from '../../modules-store';
import { isFeatureEnabled } from '../../module-features';

export function useChecklistToggle(
  checklist: Checklist | null | undefined,
  items: ChecklistTaskItem[],
  currentUserId: string | null | undefined,
) {
  const groupId = checklist?.group_id;
  const { patchRow: patchItem } = useStoreHelpers(checklistItems$(groupId), currentUserId);
  const { patchRow: patchList } = useStoreHelpers(checklists$(groupId), currentUserId);
  const { patchRow: patchTask } = useStoreHelpers(householdTasks$(groupId), currentUserId);
  const { writeRow: writeCost, softDeleteRow: softDeleteCost } = useStoreHelpers(costItems$(groupId), currentUserId);

  // Given a projected items list, tick/untick the linked dashboard to-do and
  // (for non-repeating lists) archive/unarchive via completed_at. Repeating
  // lists never auto-archive on completion — they renew on their cadence date.
  const syncCompletion = useCallback(
    (projected: ChecklistTaskItem[]) => {
      if (!checklist) return;
      const { complete: nowComplete } = completion(projected);
      const now = new Date().toISOString();
      // Modules: a linked task that already exists stays in sync even with
      // Tasks off, so it is right when Tasks comes back. Only creating one is
      // gated (module-features.ts 'tasks.checklists').
      if (checklist.linked_task_id) {
        patchTask(
          checklist.linked_task_id,
          nowComplete ? { done: true, completed_at: now } : { done: false, completed_at: null },
        );
      }
      if (checklist.type !== 'repeating') {
        // The stored row, not the render's copy: an Undo tap can land after
        // the surface that armed it unmounted (Home's Now card leaves the
        // moment its checklist completes), and that copy predates the archive.
        const stored = checklists$(checklist.group_id).peek()?.[checklist.id];
        const wasComplete = !!(stored ?? checklist).completed_at;
        if (nowComplete !== wasComplete) {
          patchList(checklist.id, { completed_at: nowComplete ? now : null } as Partial<Checklist>);
        }
      }
    },
    [checklist, patchTask, patchList],
  );

  // HOUP-327: the single bulk-toggle call site — Check all / Uncheck all pass
  // every target they mean to flip, then this fires ONE projected completion
  // sync for the whole batch (D4), never a loop of single-item syncs ending on
  // a stale intermediate state. Callers MUST pass only the rows that actually
  // need to change (e.g. `partitionDone(items).open` for Check all) — passing
  // an already-done row into a `done: true` call re-stamps its `checked_at`/
  // `checked_by`, which would scramble the "Recently checked" sort and rewrite
  // attribution for no reason.
  const setItemsDone = useCallback(
    (targets: ChecklistTaskItem[], done: boolean) => {
      if (!checklist || targets.length === 0) return;
      const targetIds = new Set(targets.map((t) => t.id));
      // Modules: logging a new purchase cost needs Costs and Checklists
      // (module-features.ts). Off: checking writes no cost row, but unchecking
      // still removes the one this item logged, so Costs is right when it
      // comes back.
      const logCosts = isFeatureEnabled('costs.from-checklists', getEnabledModules());

      for (const target of targets) {
        if (done) {
          patchItem(target.id, checkItemPatch(currentUserId));
          // Shopping: log a cost when checked (dedup guarded by the link).
          if (
            logCosts &&
            checklist.type === 'shopping' &&
            checklist.log_costs &&
            (target.cost_cents ?? 0) > 0 &&
            !target.linked_cost_item_id
          ) {
            const cost = buildLoggedCost({ item: target, checklist, createdBy: currentUserId });
            writeCost(cost);
            patchItem(target.id, { linked_cost_item_id: cost.id } as Partial<ChecklistTaskItem>);
          }
        } else {
          patchItem(target.id, uncheckItemPatch());
          if (target.linked_cost_item_id) {
            softDeleteCost(target.linked_cost_item_id);
            patchItem(target.id, { linked_cost_item_id: null } as Partial<ChecklistTaskItem>);
          }
        }
      }

      const projected = liveItems(items).map((i) => (targetIds.has(i.id) ? { ...i, is_done: done } : i));
      syncCompletion(projected);
    },
    [checklist, items, currentUserId, patchItem, writeCost, softDeleteCost, syncCompletion],
  );

  const toggleItem = useCallback(
    (item: ChecklistTaskItem) => setItemsDone([item], !item.is_done),
    [setItemsDone],
  );

  // HOUP-327/D8: every path that can empty a list (Clear completed, or
  // deleting the last remaining row) routes through this ONE helper, so two
  // routes to the same end state can never disagree. `completion()` reads an
  // empty projection as incomplete, which would un-tick the linked dashboard
  // to-do and un-archive the list on the exact one-tap tidy-up this feature
  // exists for — skip the sync entirely when nothing remains, leaving
  // `completed_at`/the linked to-do exactly as they were.
  const syncAfterClear = useCallback(
    (remaining: ChecklistTaskItem[]) => {
      if (remaining.length === 0) return;
      syncCompletion(remaining);
    },
    [syncCompletion],
  );

  return { toggleItem, setItemsDone, syncAfterClear, syncCompletion };
}
