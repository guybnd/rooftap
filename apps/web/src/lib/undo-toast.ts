import { toast } from 'sonner';
import { createUndoBatchTracker, revertPatch } from '@homeup/core';

// HOUP-245: undo pill shown after a soft-delete, mirroring added-toast.ts's style.
// A fixed toast id means a delete that lands while the pill is already showing
// updates it in place (sonner treats a repeated id as an update, resetting the
// duration) instead of stacking a second pill — the count/label just ticks up,
// matching createUndoBatchTracker's coalescing (packages/core/src/pending-actions.ts).
const UNDO_DELETE_TOAST_ID = 'homeup-undo-delete';

export function toastUndoDelete(count: number, onUndo: () => void) {
  const label = count === 1 ? 'Item deleted' : `${count} items deleted`;
  toast(label, {
    id: UNDO_DELETE_TOAST_ID,
    duration: 4000,
    action: { label: 'Undo', onClick: onUndo },
  });
}

// HOUP-332: a generic single-action undo pill for non-delete writes (e.g.
// "Checklist added") — its own toast id so it can never overwrite (or be
// overwritten by) the delete pill above, which is pinned to
// UNDO_DELETE_TOAST_ID and hardcodes its own label. Unlike toastUndoDelete,
// this isn't a coalescing batch pill — each call is its own single action.
const UNDO_ACTION_TOAST_ID = 'homeup-undo-action';

export function toastUndoAction(label: string, onUndo: () => void) {
  toast(label, {
    id: UNDO_ACTION_TOAST_ID,
    duration: 4000,
    action: { label: 'Undo', onClick: onUndo },
  });
}

// The shared single-tap undo pattern (mirrors apps/mobile/src/lib/undo-toast.ts):
// apply a patch to one or more rows now and show a coalescing Undo pill that
// writes each row's previous values back (core's `revertPatch`). Rapid taps of
// the same kind collapse into one pill with a running count (core's
// createUndoBatchTracker); each presenter owns its own toast id, so an
// "added to list" pill and a "snoozed" pill never overwrite each other.
let nextPresenterId = 0;

export interface UndoablePatch<Row> {
  id: string;
  revert: Partial<Row>;
}

/**
 * @param apply The page's row writer (useStoreHelpers' `patchRow`, which is
 *   stable, so callers can memoize the presenter on it).
 */
export function createUndoPatchPresenter<Row extends { id: string }>(options: {
  /** Pill label for the batch size; `latest` is the last row patched (to name it when `count` is 1). */
  message: (count: number, latest: Row) => string;
  apply: (id: string, patch: Partial<Row>) => void;
  durationMs?: number;
}) {
  const durationMs = options.durationMs ?? 4000;
  const toastId = `homeup-undo-patch-${++nextPresenterId}`;
  const tracker = createUndoBatchTracker<UndoablePatch<Row>>(() => {}, durationMs);

  return {
    /** Patches every row in `rows` and shows (or grows) the Undo pill. */
    run(rows: Row | Row[], patch: Partial<Row> | ((row: Row) => Partial<Row>)) {
      const list = Array.isArray(rows) ? rows : [rows];
      if (list.length === 0) return;
      list.forEach((row) => {
        const p = typeof patch === 'function' ? patch(row) : patch;
        tracker.add({ id: row.id, revert: revertPatch(row, p) });
        options.apply(row.id, p);
      });
      toast(options.message(tracker.count(), list[list.length - 1]), {
        id: toastId,
        duration: durationMs,
        action: {
          label: 'Undo',
          onClick: () => {
            tracker.restoreAll().forEach(({ id, revert }) => options.apply(id, revert));
          },
        },
      });
    },
  };
}

export type UndoPatchPresenter<Row extends { id: string }> = ReturnType<typeof createUndoPatchPresenter<Row>>;
