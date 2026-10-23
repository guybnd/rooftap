// Grocery actions with an Undo pill for the Groceries tab and the Home
// groceries widget. The actions live in core (createGroceryUndoActions in
// modules/groceries/grocery-list-view.ts); this binds the native toast.
import * as React from 'react';
import { createGroceryUndoActions, type GroceryItem } from '@homeup/core';
import { createUndoPatchPresenter } from '@/lib/undo-toast';

export function useGroceryUndo(patchRow: (id: string, patch: Partial<GroceryItem>) => void) {
  return React.useMemo(() => createGroceryUndoActions(createUndoPatchPresenter<GroceryItem>, patchRow), [patchRow]);
}
