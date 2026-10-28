'use client';

// Costs' slots (.docs/modules.md, section 17). Search: every cost line,
// which opens its editor.

import { useMemo } from 'react';
import { costItems$ } from '../../data/stores';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useSlotRows } from '../../slots/rows';
import type { SearchSource } from '../../slots/types';
import type { CostItem } from '../../types';

export function costsSearchHits(costItems: readonly CostItem[]): GlobalHit[] {
  return costItems
    .filter((c) => !c.deleted)
    .map((c) => ({
      section: 'costs',
      sectionId: 'costs',
      sectionLabel: 'Costs',
      id: c.id,
      title: c.name,
      subtitle: c.provider ?? c.category,
      keywords: [c.provider, c.notes, c.category].filter(Boolean).join(' '),
    }));
}

export const costsSearchSource: SearchSource = {
  moduleId: 'costs',
  useHits({ groupId, active }) {
    const costItems = useSlotRows(costItems$, groupId, active);
    return useMemo(() => ({ hits: costsSearchHits(costItems) }), [costItems]);
  },
};
