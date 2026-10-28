'use client';

// Groceries' slots (.docs/modules.md, section 17). Search: every item on the
// list, which opens its editor.

import { useMemo } from 'react';
import { groceryItems$ } from '../../data/stores';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useSlotRows } from '../../slots/rows';
import type { SearchSource } from '../../slots/types';
import type { GroceryItem } from '../../types';

export function groceriesSearchHits(groceries: readonly GroceryItem[]): GlobalHit[] {
  return groceries
    .filter((g) => !g.deleted)
    .map((g) => ({
      section: 'groceries',
      sectionId: 'groceries',
      sectionLabel: 'Groceries',
      id: g.id,
      title: g.name,
      subtitle: g.aisle,
      keywords: [g.notes].filter(Boolean).join(' '),
    }));
}

export const groceriesSearchSource: SearchSource = {
  moduleId: 'groceries',
  useHits({ groupId, active }) {
    const groceries = useSlotRows(groceryItems$, groupId, active);
    return useMemo(() => ({ hits: groceriesSearchHits(groceries) }), [groceries]);
  },
};
