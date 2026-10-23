'use client';

// Swipe or menu snooze with an Undo pill for /tasks and Home. The snooze lives
// in core (createTaskSnoozeUndo in modules/household/task-list-view.ts); this
// binds the web toast.
import { useMemo } from 'react';
import { createTaskSnoozeUndo, type HouseholdTask } from '@homeup/core';
import { createUndoPatchPresenter } from '@/lib/undo-toast';

export function useTaskSnoozeUndo(patchRow: (id: string, patch: Partial<HouseholdTask>) => void) {
  return useMemo(() => createTaskSnoozeUndo(createUndoPatchPresenter<HouseholdTask>, patchRow), [patchRow]);
}
