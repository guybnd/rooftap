'use client';

// HOUP-332: the single item-write hook for a checklist's items — add / delete /
// restore (batched) / rename / re-price — composing useChecklistToggle so the
// completion sync (`syncCompletion`/`syncAfterClear`) stays owned in exactly one
// place. Every surface that writes checklist items (both detail screens, both
// inline /tasks panels) binds this ONE hook instead of re-deriving
// syncCompletion(liveItems(...)) by hand, which is what let `commitLabels` (add)
// go un-synced on both detail screens before this ticket.
//
// Freshness contract (load-bearing): `addItems`/`deleteItem`/`restoreItems` read
// `{ items, checklist, syncCompletion, syncAfterClear }` through one ref
// reassigned every render, never through their own render-time capture. A
// restore fires long after the render that produced it (an Undo tap on a toast
// whose presenter was memoized once with `[]`), so a captured `items` array
// would compute the wrong `done` for the linked to-do (delete A, tick B, tap
// Undo). This is freshness, not referential stability — these closures are NOT
// claimed stable across renders. The re-exported `toggleItem` / `setItemsDone` /
// `syncAfterClear` keep useChecklistToggle's own identities; they're only ever
// invoked from an active render, never stashed for later.

import { useCallback, useRef } from 'react';
import type { Checklist, ChecklistTaskItem } from '../types';
import { checklistItems$ } from './stores';
import { useStoreHelpers } from './create-group-store';
import { useChecklistToggle } from './use-checklist-toggle';
import { buildAppendedItems, liveItems, renameItemPatch, setItemCostPatch } from '../checklists';

export interface UseChecklistItemActionsResult {
  toggleItem: (item: ChecklistTaskItem) => void;
  setItemsDone: (targets: ChecklistTaskItem[], done: boolean) => void;
  syncAfterClear: (remaining: ChecklistTaskItem[]) => void;
  /** Appends N items, syncing completion over the projected list — fixes "add never syncs". */
  addItems: (labels: string[], opts?: { costCents?: number | null }) => ChecklistTaskItem[];
  /** Soft-deletes one item. Routes through the same empty-list guard as `syncAfterClear` (D8). */
  deleteItem: (item: ChecklistTaskItem) => void;
  /** Restores a whole batch in one patch pass + ONE completion sync — never per-item. */
  restoreItems: (items: ChecklistTaskItem[]) => void;
  /** Undo for ticks: unchecks these rows as the store holds them now (see below). */
  uncheckItems: (ids: string[]) => void;
  renameItem: (item: ChecklistTaskItem, label: string) => void;
  repriceItem: (item: ChecklistTaskItem, dollars: string) => void;
}

export function useChecklistItemActions(
  checklist: Checklist | null | undefined,
  items: ChecklistTaskItem[],
  currentUserId: string | null | undefined,
): UseChecklistItemActionsResult {
  const groupId = checklist?.group_id;
  const { toggleItem, setItemsDone, syncAfterClear, syncCompletion } = useChecklistToggle(
    checklist,
    items,
    currentUserId,
  );
  const { writeRow: writeItem, patchRow: patchItem, softDeleteRow: softDeleteItem } = useStoreHelpers(
    checklistItems$(groupId),
    currentUserId,
  );

  const stateRef = useRef({ items, checklist, syncCompletion, syncAfterClear, setItemsDone });
  stateRef.current = { items, checklist, syncCompletion, syncAfterClear, setItemsDone };

  const addItems = useCallback(
    (labels: string[], opts?: { costCents?: number | null }): ChecklistTaskItem[] => {
      const { items: liveItemsNow, checklist: checklistNow, syncCompletion: syncNow } = stateRef.current;
      if (!checklistNow) return [];
      const rows = buildAppendedItems({
        checklistId: checklistNow.id,
        groupId: checklistNow.group_id,
        labels,
        existing: liveItemsNow,
        costCents: opts?.costCents ?? null,
      });
      if (rows.length === 0) return [];
      rows.forEach((row) => writeItem(row));
      syncNow(liveItems([...liveItemsNow, ...rows]));
      return rows;
    },
    [writeItem],
  );

  const deleteItem = useCallback(
    (item: ChecklistTaskItem) => {
      softDeleteItem(item.id);
      const { items: liveItemsNow, syncAfterClear: syncAfterClearNow } = stateRef.current;
      syncAfterClearNow(liveItems(liveItemsNow).filter((i) => i.id !== item.id));
    },
    [softDeleteItem],
  );

  const restoreItems = useCallback(
    (restored: ChecklistTaskItem[]) => {
      if (restored.length === 0) return;
      restored.forEach((it) => patchItem(it.id, { deleted: false } as Partial<ChecklistTaskItem>));
      const { items: liveItemsNow, syncCompletion: syncNow } = stateRef.current;
      syncNow(liveItems([...liveItemsNow, ...restored.map((it) => ({ ...it, deleted: false }))]));
    },
    [patchItem],
  );

  // The inline panels' "Item checked" Undo. Takes ids and reads each row from
  // the store at call time: the tap can land after the panel unmounted (Home's
  // Now card leaves the moment its checklist completes), when the copies this
  // hook was handed may be a write behind, and a stale row would miss the cost
  // a Shopping tick logged. Rows unchecked or deleted since are skipped.
  const uncheckItems = useCallback((ids: string[]) => {
    const { checklist: checklistNow, setItemsDone: setDoneNow } = stateRef.current;
    if (!checklistNow || ids.length === 0) return;
    const stored = checklistItems$(checklistNow.group_id).peek() ?? {};
    const targets = ids
      .map((id) => stored[id])
      .filter((row): row is ChecklistTaskItem => !!row && row.is_done && !row.deleted);
    setDoneNow(targets, false);
  }, []);

  const renameItem = useCallback(
    (item: ChecklistTaskItem, label: string) => {
      const patch = renameItemPatch(label);
      if (patch) patchItem(item.id, patch as Partial<ChecklistTaskItem>);
    },
    [patchItem],
  );

  const repriceItem = useCallback(
    (item: ChecklistTaskItem, dollars: string) => {
      patchItem(item.id, setItemCostPatch(dollars) as Partial<ChecklistTaskItem>);
    },
    [patchItem],
  );

  return { toggleItem, setItemsDone, syncAfterClear, addItems, deleteItem, restoreItems, uncheckItems, renameItem, repriceItem };
}
