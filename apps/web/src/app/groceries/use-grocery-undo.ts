'use client';

// Grocery actions with an Undo pill for the /groceries page and the Home
// groceries widget. The actions live in core (createGroceryUndoActions in
// modules/groceries/grocery-list-view.ts); this binds the web toast.
import { useMemo } from 'react';
import { createGroceryUndoActions, type GroceryItem } from '@homeup/core';
import { createUndoPatchPresenter } from '@/lib/undo-toast';

export function useGroceryUndo(patchItem: (id: string, patch: Partial<GroceryItem>) => void) {
  return useMemo(() => createGroceryUndoActions(createUndoPatchPresenter<GroceryItem>, patchItem), [patchItem]);
}
