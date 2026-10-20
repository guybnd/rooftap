// HOUP-245: thin wrapper around @homeup/core's createUndoBatchTracker that
// presents the batch as ONE coalescing toast pill (not N stacked toasts).
// Each `addAndShow` restarts the tracker's shared window and swaps in a
// fresh toast with the updated count, dismissing whichever pill was already
// showing for this batch. Kept dumb on purpose: no filtering/list logic
// here, just tracker <-> toast wiring — each screen owns its own instance
// and its own `restore` callback.
import { dismissToast, toast } from '@homeup/ui';
import { createUndoBatchTracker, revertPatch, type UndoBatchTracker } from '@homeup/core';

export interface UndoToastPresenter<T> {
  tracker: UndoBatchTracker<T>;
  /** Adds `item` to the batch and (re)shows the single pill for it. */
  addAndShow(item: T): void;
  /** Adds every item (e.g. an "Add all") and shows the pill once, not N times. */
  addAllAndShow(items: T[]): void;
}

/**
 * @param message Label for the pill, given the current batch size (e.g. `n => n === 1 ? 'Item deleted' : \`${n} items deleted\``).
 * @param restore Called once per item, only when the user taps Undo.
 * @param onExpire Called once with every batch member if the window lapses without an undo (e.g. to learn a library entry) — optional.
 */
export function createUndoToastPresenter<T>(options: {
  message: (count: number) => string;
  restore: (item: T) => void;
  /**
   * HOUP-327: when present, called ONCE with the whole restored batch instead
   * of `restore` firing once per item. A per-item `restore` that reads live
   * state through a ref (as this screen's checklist restore does) can't see
   * its own sibling calls land within one synchronous loop, so a batched
   * caller (three checklist items restored at once) would sync completion
   * against a stale projection after each call. Preferred over `restore`
   * whenever supplied; `restore` still fires for every other caller
   * (groceries/home/tasks) that hasn't opted in.
   */
  restoreAll?: (items: T[]) => void;
  onExpire?: (items: T[]) => void;
  durationMs?: number;
}): UndoToastPresenter<T> {
  const durationMs = options.durationMs ?? 4000;
  let activeToastId: string | null = null;

  const tracker = createUndoBatchTracker<T>((expired) => {
    activeToastId = null;
    options.onExpire?.(expired);
  }, durationMs);

  function present(): void {
    if (activeToastId) dismissToast(activeToastId);
    activeToastId = toast.message(options.message(tracker.count()), {
      duration: durationMs,
      action: {
        label: 'Undo',
        onPress: () => {
          activeToastId = null;
          const restored = tracker.restoreAll();
          if (options.restoreAll) options.restoreAll(restored);
          else restored.forEach(options.restore);
        },
      },
    });
  }

  return {
    tracker,
    addAndShow(item: T) {
      tracker.add(item);
      present();
    },
    addAllAndShow(items: T[]) {
      if (items.length === 0) return;
      items.forEach((item) => tracker.add(item));
      present();
    },
  };
}

/** One row's undo record: its id and the fields to write back on Undo. */
export interface UndoablePatch<Row> {
  id: string;
  revert: Partial<Row>;
}

/**
 * The shared single-tap undo pattern: apply a patch to one or more rows now
 * and show a coalescing Undo pill that writes each row's previous values back
 * (core's `revertPatch`). Mirrors apps/web/src/lib/undo-toast.ts's
 * `createUndoPatchPresenter`. Each screen keeps one presenter per action kind
 * ("added to list", "snoozed") so a pill never mixes two kinds of change.
 *
 * @param apply The screen's row writer (useStoreHelpers' `patchRow`, which is
 *   stable, so callers can memoize the presenter on it).
 */
export function createUndoPatchPresenter<Row extends { id: string }>(options: {
  /** Pill label for the batch size; `latest` is the last row patched (to name it when `count` is 1). */
  message: (count: number, latest: Row) => string;
  apply: (id: string, patch: Partial<Row>) => void;
  durationMs?: number;
}) {
  let latest: Row | undefined;
  const presenter = createUndoToastPresenter<UndoablePatch<Row>>({
    message: (count) => options.message(count, latest!),
    restore: ({ id, revert }) => options.apply(id, revert),
    durationMs: options.durationMs,
  });
  return {
    /** Patches every row in `rows` and shows (or grows) the Undo pill. */
    run(rows: Row | Row[], patch: Partial<Row> | ((row: Row) => Partial<Row>)) {
      const list = Array.isArray(rows) ? rows : [rows];
      if (list.length === 0) return;
      latest = list[list.length - 1];
      const records = list.map((row) => {
        const p = typeof patch === 'function' ? patch(row) : patch;
        const record = { id: row.id, revert: revertPatch(row, p) };
        options.apply(row.id, p);
        return record;
      });
      presenter.addAllAndShow(records);
    },
  };
}

export type UndoPatchPresenter<Row extends { id: string }> = ReturnType<typeof createUndoPatchPresenter<Row>>;
