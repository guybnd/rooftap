'use client';

// Tasks' slots (.docs/modules.md, section 17). Search: every to-do, which
// opens its editor.

import { useMemo } from 'react';
import { householdTasks$ } from '../../data/stores';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useSlotRows } from '../../slots/rows';
import type { SearchSource } from '../../slots/types';
import type { HouseholdTask } from '../../types';

export function tasksSearchHits(tasks: readonly HouseholdTask[]): GlobalHit[] {
  return tasks
    .filter((t) => !t.deleted)
    .map((t) => ({
      section: 'tasks',
      sectionId: 'household',
      sectionLabel: 'Tasks',
      id: t.id,
      title: t.title,
      subtitle: t.due_date ?? undefined,
      keywords: [t.notes].filter(Boolean).join(' '),
    }));
}

export const tasksSearchSource: SearchSource = {
  moduleId: 'household',
  useHits({ groupId, active }) {
    const tasks = useSlotRows(householdTasks$, groupId, active);
    return useMemo(() => ({ hits: tasksSearchHits(tasks) }), [tasks]);
  },
};
