// HOUP-123: native port of apps/web/src/app/tasks/task-row.tsx's ChecklistMeter
// and apps/web/src/app/tasks/task-checklist-panel.tsx's TaskChecklistPanel — the
// inline "Checklist N/M" portal chip's meter + its expanding panel.
//
// HOUP-332: the panel is now a real editor, not a read-only tick list — it
// renders through the shared `ChecklistItemList` primitive (`variant="inline"`)
// so add/rename/re-price/delete/band-fold behave identically to the detail
// screen. Item writes go through `useChecklistItemActions` (composes
// `useChecklistToggle` internally, so completion sync stays owned in one
// place); band-fold state binds `useChecklistViewPrefs` keyed by the
// checklist's own id — per LIST, not per surface, so folding here folds on the
// detail screen too. Delete shows its own single-item undo pill via
// `@homeup/ui`'s own toast (this panel has no access to the app-level
// `createUndoToastPresenter` wrapper, and a single inline delete doesn't need
// its batch-coalescing).
//
// Ticking an item shows an "Item checked" pill with Undo (quick ticks
// coalesce into one pill with a count); the ticked row also lands at the top
// of the Completed band (core partitionDone). Unticking needs no pill.
import * as React from 'react';
import { View } from 'react-native';
import {
  checkedToastLabel,
  createUndoBatchTracker,
  useChecklistItemActions,
  useChecklistViewPrefs,
  type Checklist,
  type ChecklistTaskItem,
} from '@homeup/core';
import { dismissToast, toast } from '../lib/toast-store';
import { celebrate, remove, select, tick } from '../lib/haptics';
import { ChecklistItemList } from './checklist-item-list';

// FLUX-270/H3 parity: a checklist's live progress, scoped inline to the row it
// measures (~52px x ~3px) — never edge-to-edge. Success-hued per the color-roles table.
export function ChecklistMeter({ done, total }: { done: number; total: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      className="h-[3px] w-[52px] shrink-0 overflow-hidden rounded-full bg-muted"
    >
      <View className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
    </View>
  );
}

const TICK_UNDO_MS = 4000;

export interface TaskChecklistPanelProps {
  checklist: Checklist;
  items: ChecklistTaskItem[];
  currentUserId?: string | null;
  /** Navigate to the full checklist detail screen — omit to hide the link. */
  onOpenFull?: () => void;
  /** Focus the add well's label input once, on mount (quick-menu create flow). */
  autoFocusAdd?: boolean;
}

export function TaskChecklistPanel({ checklist, items, currentUserId, onOpenFull, autoFocusAdd }: TaskChecklistPanelProps) {
  const actions = useChecklistItemActions(checklist, items, currentUserId);
  // Per-list device prefs (HOUP-327), keyed by checklist id — folding the
  // Completed band here folds it on the detail screen too. No userSettings
  // access from a row-bound panel, so this falls back to the same defaults
  // the account-default fields themselves default to.
  const viewPrefs = useChecklistViewPrefs(checklist.id, checklist.type, {
    sortMode: null,
    completedToBottom: true,
    collapsed: false,
  });

  // The tick pill's Undo can fire after this panel has unmounted (Home's Now
  // card leaves when its checklist completes), so it calls the latest actions
  // through a ref; uncheckItems reads the rows fresh from the store.
  const actionsRef = React.useRef(actions);
  actionsRef.current = actions;
  const ticks = React.useMemo(() => {
    let pillId: string | null = null;
    const tracker = createUndoBatchTracker<string>(() => {
      pillId = null;
    }, TICK_UNDO_MS);
    return {
      add(id: string) {
        tracker.add(id);
        if (pillId) dismissToast(pillId);
        pillId = toast.message(checkedToastLabel(tracker.count()), {
          duration: TICK_UNDO_MS,
          action: {
            label: 'Undo',
            onPress: () => {
              pillId = null;
              actionsRef.current.uncheckItems(tracker.restoreAll());
            },
          },
        });
      },
    };
  }, []);

  const handleToggle = (item: ChecklistTaskItem) => {
    // Read before the write: the store patches this same row object in place.
    const ticking = !item.is_done;
    // HA: the check that finishes the list rolls; others click.
    if (ticking && items.every((i) => i.id === item.id || i.is_done)) celebrate();
    else if (ticking) tick();
    else select();
    actions.toggleItem(item);
    if (ticking) ticks.add(item.id);
  };

  const handleDelete = (item: ChecklistTaskItem) => {
    remove();
    actions.deleteItem(item);
    toast.message('Item deleted', {
      duration: 4000,
      action: { label: 'Undo', onPress: () => actions.restoreItems([item]) },
    });
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
      onOpenFull={onOpenFull}
      autoFocusAdd={autoFocusAdd}
    />
  );
}
