'use client';

// Checklists' slots (.docs/modules.md, section 17). Search: every
// checklist, which opens it.

import { useMemo } from 'react';
import { checklists$ } from '../../data/stores';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useSlotRows } from '../../slots/rows';
import type { SearchSource } from '../../slots/types';
import type { Checklist } from '../../types';

export function checklistsSearchHits(checklists: readonly Checklist[]): GlobalHit[] {
  return checklists
    .filter((c) => !c.deleted)
    .map((c) => ({
      section: 'checklists',
      sectionId: 'checklists',
      sectionLabel: 'Checklists',
      id: c.id,
      title: c.title,
      subtitle: c.completed_at ? 'Completed' : c.type,
      keywords: c.type,
      href: `/checklists/${c.id}`,
    }));
}

export const checklistsSearchSource: SearchSource = {
  moduleId: 'checklists',
  useHits({ groupId, active }) {
    const checklists = useSlotRows(checklists$, groupId, active);
    return useMemo(() => ({ hits: checklistsSearchHits(checklists) }), [checklists]);
  },
};
