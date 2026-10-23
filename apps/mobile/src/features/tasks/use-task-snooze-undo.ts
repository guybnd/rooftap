// Swipe or menu snooze with an Undo pill for the Tasks tab and Home. The
// snooze lives in core (createTaskSnoozeUndo in
// modules/household/task-list-view.ts); this binds the native toast.
import * as React from 'react';
import { createTaskSnoozeUndo, type HouseholdTask } from '@homeup/core';
import { createUndoPatchPresenter } from '@/lib/undo-toast';

export function useTaskSnoozeUndo(patchRow: (id: string, patch: Partial<HouseholdTask>) => void) {
  return React.useMemo(() => createTaskSnoozeUndo(createUndoPatchPresenter<HouseholdTask>, patchRow), [patchRow]);
}
