"use client";

// The web's toasts for core's archive and delete steps (archive-undo.ts).
// Native twin: apps/mobile/src/lib/archive-toast.ts.
import { toast } from "sonner";
import type { UndoToast } from "@homeup/core";

export const archiveToast: UndoToast = {
  undo: (message, onUndo) => {
    toast(message, { duration: 5000, action: { label: "Undo", onClick: onUndo } });
  },
  message: (message) => {
    toast(message);
  },
  error: (message) => {
    toast.error(message);
  },
};
