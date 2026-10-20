'use client';

// FLUX-1558/HOUP-332: the /tasks TaskRow's expanded checklist panel. Now a
// real editor (not read-only tick), rendered through the shared
// ChecklistItemList primitive (variant="inline", also used by the checklist
// detail page) so add/rename/re-price/delete/band-fold behave identically.
// Item writes go through useChecklistItemActions so cost-logging + completion
// sync can never fork from the full checklist detail page. Sort menu, bulk
// actions, reorder, settings stay detail-only behind "Open full checklist ›".
//
// Ticking an item shows an "Item checked" pill with Undo (quick ticks
// coalesce into one pill with a count); the ticked row also lands at the top
// of the Completed band (core partitionDone). Unticking needs no pill. Home's
// Now card opens this panel in place for a dated checklist.

import { useMemo, useRef } from 'react';
import { checkedToastLabel, createUndoBatchTracker, useChecklistItemActions, useChecklistViewPrefs } from '@homeup/core';
import type { Checklist, ChecklistTaskItem } from '@homeup/core';
import { ChecklistItemList } from '@/components/checklist-item-list';
import { toastUndoAction, toastUndoDelete } from '@/lib/undo-toast';

const TICK_UNDO_MS = 4000;

interface TaskChecklistPanelProps {
  checklist: Checklist;
  items: ChecklistTaskItem[];
  currentUserId?: string | null;
  /** Focus the add well's label input once, on mount (quick-menu create flow). */
  autoFocusAdd?: boolean;
}

export function TaskChecklistPanel({ checklist, items, currentUserId, autoFocusAdd }: TaskChecklistPanelProps) {
  const actions = useChecklistItemActions(checklist, items, currentUserId);
  // Per-list device prefs (HOUP-327), keyed by checklist id — folding the
  // Completed band here folds it on the detail page too. No userSettings
  // access from a row-bound panel, so this falls back to the same defaults
  // the account-default fields themselves default to.
  const viewPrefs = useChecklistViewPrefs(checklist.id, checklist.type, {
    sortMode: null,
    completedToBottom: true,
    collapsed: false,
  });

  // HOUP-332 review fix: coalesce rapid deletes into one pill, mirroring the
  // detail page's removeItems (apps/web/src/app/checklists/[id]/page.tsx) —
  // without a shared tracker, a second delete within the 4s window replaces
  // toastUndoDelete's fixed-id pill (and its Undo closure), stranding the
  // first item soft-deleted with no way back.
  const undoBatchTracker = useMemo(() => createUndoBatchTracker<ChecklistTaskItem>(() => {}), []);

  // The tick pill's Undo can fire after this panel has unmounted (Home's Now
  // card leaves when its checklist completes), so it calls the latest actions
  // through a ref; uncheckItems reads the rows fresh from the store.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const tickTracker = useMemo(() => createUndoBatchTracker<string>(() => {}, TICK_UNDO_MS), []);

  const handleToggle = (item: ChecklistTaskItem) => {
    // Read before the write: the store patches this same row object in place.
    const ticking = !item.is_done;
    actions.toggleItem(item);
    if (!ticking) return;
    tickTracker.add(item.id);
    toastUndoAction(checkedToastLabel(tickTracker.count()), () => actionsRef.current.uncheckItems(tickTracker.restoreAll()));
  };

  const handleDelete = (item: ChecklistTaskItem) => {
    actions.deleteItem(item);
    undoBatchTracker.add(item);
    toastUndoDelete(undoBatchTracker.count(), () => actions.restoreItems(undoBatchTracker.restoreAll()));
  };

  return (
    <ChecklistItemList
      checklist={checklist}
      orderedItems={items}
      viewPrefs={viewPrefs}
      variant="inline"
      onToggle={handleToggle}
      onAdd={actions.addItems}
      onRename={actions.renameItem}
      onReprice={actions.repriceItem}
      onDelete={handleDelete}
      openFullHref={`/checklists/${checklist.id}`}
      autoFocusAdd={autoFocusAdd}
    />
  );
}
