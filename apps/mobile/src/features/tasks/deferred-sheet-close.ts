import { MOTION_DURATIONS_MS, type HouseholdTask } from '@homeup/core';

/**
 * HOUP-191: every close path (Cancel/backdrop/drag/back/Save/Delete) on a
 * sheet keyed by the edited item's id must flip `open` false immediately —
 * so the exit animation plays — and defer any store write plus clearing the
 * edited-item id until that animation finishes. Clearing the id in the same
 * tick as `open=false` changes the sheet's `key` and remounts it mid-close,
 * which skips the exit animation entirely (see apps/mobile/src/app/tasks/
 * index.tsx's HouseholdTaskModal usage for the full incident writeup).
 */
export function closeThenCommit(setOpen: (open: boolean) => void, commit: () => void): void {
  setOpen(false);
  setTimeout(commit, MOTION_DURATIONS_MS.exit);
}

interface HouseholdTaskModalCallbackOptions {
  editingTask?: HouseholdTask;
  setModalOpen: (open: boolean) => void;
  setEditingTask: (task: HouseholdTask | undefined) => void;
  writeRow: (task: HouseholdTask) => void;
  softDeleteRow: (taskId: string) => void;
  pinNewTask: (taskId: string) => void;
}

export function createHouseholdTaskModalCallbacks({
  editingTask,
  setModalOpen,
  setEditingTask,
  writeRow,
  softDeleteRow,
  pinNewTask,
}: HouseholdTaskModalCallbackOptions): {
  onClose: () => void;
  onSave: (task: HouseholdTask) => void;
  onDelete: (taskId: string) => void;
} {
  return {
    onClose: () => closeThenCommit(setModalOpen, () => setEditingTask(undefined)),
    onSave: (saved) => {
      const isNew = !editingTask;
      closeThenCommit(setModalOpen, () => {
        writeRow(saved);
        if (isNew) pinNewTask(saved.id);
        setEditingTask(undefined);
      });
    },
    onDelete: (taskId) => {
      closeThenCommit(setModalOpen, () => {
        softDeleteRow(taskId);
        setEditingTask(undefined);
      });
    },
  };
}
