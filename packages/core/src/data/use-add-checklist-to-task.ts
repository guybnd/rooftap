'use client';

// HOUP-332: binds the two writes behind "add a checklist from a task" —
// creating the linked list and patching the task's `linked_checklist_id` —
// plus the undo that reverses both. Bound directly by the row components
// (TaskRow/HeroTaskRow, both kits) rather than threaded as a prop from the
// four store-owning screens: the row already binds stores for this domain
// (TaskChecklistPanel -> useChecklistToggle -> useStoreHelpers), and
// useStoreHelpers returns plain useCallback writers with no subscriptions, so
// binding it per rendered row costs nothing. `linkNewChecklistToTask` is the
// only producer of the task<->checklist link; this hook is its only caller.

import { useCallback } from 'react';
import type { Checklist, HouseholdTask } from '../types';
import { checklists$, householdTasks$ } from './stores';
import { useStoreHelpers } from './create-group-store';
import { linkNewChecklistToTask } from '../checklists';

export interface UseAddChecklistToTaskResult {
  addChecklist(): { checklist: Checklist; undo: () => void };
}

export function useAddChecklistToTask(
  task: HouseholdTask,
  currentUserId: string | null | undefined,
): UseAddChecklistToTaskResult {
  const { writeRow: writeChecklist, softDeleteRow: softDeleteChecklist } = useStoreHelpers(
    checklists$(task.group_id),
    currentUserId,
  );
  const { patchRow: patchTask } = useStoreHelpers(householdTasks$(task.group_id), currentUserId);

  const addChecklist = useCallback((): { checklist: Checklist; undo: () => void } => {
    const { checklist, taskPatch } = linkNewChecklistToTask({ task, createdBy: currentUserId });
    writeChecklist(checklist);
    patchTask(task.id, taskPatch as Partial<HouseholdTask>);
    const undo = () => {
      softDeleteChecklist(checklist.id);
      patchTask(task.id, { linked_checklist_id: null } as Partial<HouseholdTask>);
    };
    return { checklist, undo };
  }, [task, currentUserId, writeChecklist, patchTask, softDeleteChecklist]);

  return { addChecklist };
}
