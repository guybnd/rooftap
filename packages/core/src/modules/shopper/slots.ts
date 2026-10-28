'use client';

// Shopper's slots (.docs/modules.md, section 17). Search: every watched or
// bought item.

import { useMemo } from 'react';
import { shopperWants$ } from '../../data/stores';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useSlotRows } from '../../slots/rows';
import type { SearchSource } from '../../slots/types';
import type { ShopperWant } from './shopper';

export function shopperSearchHits(wants: readonly ShopperWant[]): GlobalHit[] {
  return wants
    .filter((w) => !w.deleted)
    .map((w) => ({
      section: 'shopper',
      sectionId: 'shopper',
      sectionLabel: 'Shopper',
      id: w.id,
      title: w.title,
      subtitle: w.status === 'bought' ? 'Bought' : w.best_store ?? undefined,
      keywords: [w.query, w.notes].filter(Boolean).join(' '),
      href: `/shopper/${w.id}`,
    }));
}

export const shopperSearchSource: SearchSource = {
  moduleId: 'shopper',
  useHits({ groupId, active }) {
    const wants = useSlotRows(shopperWants$, groupId, active);
    return useMemo(() => ({ hits: shopperSearchHits(wants) }), [wants]);
  },
};
