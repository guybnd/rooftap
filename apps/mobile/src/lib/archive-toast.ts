// Native toasts for core's archive and delete steps (archive-undo.ts).
// Web twin: apps/web/src/lib/archive-toast.ts.
import { toast } from '@homeup/ui';
import type { UndoToast } from '@homeup/core';

export const archiveToast: UndoToast = {
  undo: (message, onUndo) => {
    toast.message(message, { duration: 5000, action: { label: 'Undo', onPress: onUndo } });
  },
  message: (message) => {
    toast.message(message);
  },
  error: (message) => {
    toast.error(message);
  },
};
