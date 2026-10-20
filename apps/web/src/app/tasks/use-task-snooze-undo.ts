'use client';

// Swipe or menu snooze with an Undo pill that puts the due date/time back.
// Shared by /tasks and Home. Mirrors apps/mobile/src/features/tasks/use-task-snooze-undo.ts.
import { useMemo } from 'react';
import { taskSnoozePatch, taskSnoozeUndoLabel, type HouseholdTask, type TaskSnooze } from '@homeup/core';
import { createUndoPatchPresenter } from '@/lib/undo-toast';

export function useTaskSnoozeUndo(patchRow: (id: string, patch: Partial<HouseholdTask>) => void) {
  return useMemo(() => {
    const presenter = createUndoPatchPresenter<HouseholdTask>({
      message: (count) => taskSnoozeUndoLabel(count),
      apply: patchRow,
    });
    return (task: HouseholdTask, dur: TaskSnooze, today?: string) =>
      presenter.run(task, taskSnoozePatch(task, dur, today));
  }, [patchRow]);
}
