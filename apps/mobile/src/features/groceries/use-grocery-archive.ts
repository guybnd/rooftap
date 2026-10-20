// Archive = soft-delete now + a coalescing Undo pill; the item's learnable
// details go into the shared library only once the pill expires, so an undone
// archive never teaches the library from a row the user kept (HOUP-245/224).
// Shared by the Groceries tab and the Home groceries widget.
import * as React from 'react';
import { learnItemLibrary, type GroceryItem } from '@homeup/core';
import { createUndoToastPresenter } from '@/lib/undo-toast';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';

export function useGroceryArchive(
  groupId: string | null | undefined,
  patchRow: (id: string, patch: Partial<GroceryItem>) => void,
  softDeleteRow: (id: string) => void,
) {
  // Read through refs: the presenter is created once but restore/onExpire
  // fire later.
  const groupIdRef = React.useRef(groupId);
  groupIdRef.current = groupId;
  const patchRowRef = React.useRef(patchRow);
  patchRowRef.current = patchRow;

  const presenter = React.useMemo(
    () =>
      createUndoToastPresenter<GroceryItem>({
        message: (count) => (count === 1 ? 'Item archived to library' : `${count} items archived to library`),
        restore: (item) => patchRowRef.current(item.id, { deleted: false }),
        onExpire: (expired) => {
          const gid = groupIdRef.current;
          if (!gid) return;
          const supabase = getCurrentSupabaseClient();
          expired.forEach((item) => {
            void learnItemLibrary(supabase, gid, item.name, {
              shelf_life_days: item.shelf_life_days,
              typical_price_cents: item.price_cents,
              aisle: item.aisle,
            });
          });
        },
      }),
    []
  );

  return React.useCallback(
    (item: GroceryItem) => {
      softDeleteRow(item.id);
      presenter.addAndShow(item);
    },
    [softDeleteRow, presenter]
  );
}
