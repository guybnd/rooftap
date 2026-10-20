// Swipe or menu snooze with an Undo pill that puts the due date/time back.
// Shared by the Tasks tab and Home. Mirrors apps/web/src/app/tasks/use-task-snooze-undo.ts.
import * as React from 'react';
import { taskSnoozePatch, taskSnoozeUndoLabel, type HouseholdTask, type TaskSnooze } from '@homeup/core';
import { createUndoPatchPresenter } from '@/lib/undo-toast';

export function useTaskSnoozeUndo(patchRow: (id: string, patch: Partial<HouseholdTask>) => void) {
  return React.useMemo(() => {
    const presenter = createUndoPatchPresenter<HouseholdTask>({
      message: (count) => taskSnoozeUndoLabel(count),
      apply: patchRow,
    });
    return (task: HouseholdTask, dur: TaskSnooze) => presenter.run(task, taskSnoozePatch(task, dur));
  }, [patchRow]);
}
