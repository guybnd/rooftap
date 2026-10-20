// Single-tap grocery actions with an Undo pill: Buy again chips, re-add
// suggestions' Add / Add all / Snooze / Not now, and Reset bought. One
// presenter per action kind so rapid taps of the same kind coalesce into one
// pill ("3 items added to list") without mixing kinds. Shared by the
// Groceries tab and the Home groceries widget. Mirrors
// apps/web/src/app/groceries/use-grocery-undo.ts.
import * as React from 'react';
import { GROCERY_UNDO_LABELS, groceryNeedAgainPatch, type GroceryItem } from '@homeup/core';
import { createUndoPatchPresenter } from '@/lib/undo-toast';

export function useGroceryUndo(patchRow: (id: string, patch: Partial<GroceryItem>) => void) {
  return React.useMemo(() => {
    const apply = patchRow;
    const added = createUndoPatchPresenter<GroceryItem>({ message: (n, item) => GROCERY_UNDO_LABELS.added(n, item.name), apply });
    const snoozed = createUndoPatchPresenter<GroceryItem>({ message: (n, item) => GROCERY_UNDO_LABELS.snoozed(n, item.name), apply });
    const hidden = createUndoPatchPresenter<GroceryItem>({ message: (n, item) => GROCERY_UNDO_LABELS.hidden(n, item.name), apply });
    const reset = createUndoPatchPresenter<GroceryItem>({ message: (count) => GROCERY_UNDO_LABELS.reset(count), apply });
    return {
      /** Back to Needed: a Buy again chip, a suggestion's Add, or Add all. */
      needAgain: (items: GroceryItem | GroceryItem[]) => added.run(items, groceryNeedAgainPatch()),
      snooze: (item: GroceryItem, untilISO: string) => snoozed.run(item, { re_add_snoozed_until: untilISO }),
      /** The X's "Not now": hide the suggestion until the item is next bought. */
      hide: (item: GroceryItem) => hidden.run(item, { re_add_dismissed_at: new Date().toISOString() }),
      resetBought: (items: GroceryItem[]) =>
        reset.run(items, { status: 'needed', last_purchased_at: null, status_changed_at: new Date().toISOString() }),
    };
  }, [patchRow]);
}
