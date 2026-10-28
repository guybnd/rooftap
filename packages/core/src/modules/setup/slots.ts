'use client';

// Home Setup's slots (.docs/modules.md, section 17). Search: every item,
// which opens Setup.

import { useMemo } from 'react';
import { setupItems$ } from '../../data/stores';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useSlotRows } from '../../slots/rows';
import type { SearchSource } from '../../slots/types';
import type { SetupItem } from '../../types';

export function setupSearchHits(setupItems: readonly SetupItem[]): GlobalHit[] {
  return setupItems
    .filter((s) => !s.deleted)
    .map((s) => ({
      section: 'setup',
      sectionId: 'setup',
      sectionLabel: 'Setup',
      id: s.id,
      title: s.name,
      subtitle: s.room,
      keywords: [s.where_to_buy, s.notes, s.room].filter(Boolean).join(' '),
      href: '/setup',
    }));
}

export const setupSearchSource: SearchSource = {
  moduleId: 'setup',
  useHits({ groupId, active }) {
    const setupItems = useSlotRows(setupItems$, groupId, active);
    return useMemo(() => ({ hits: setupSearchHits(setupItems) }), [setupItems]);
  },
};
