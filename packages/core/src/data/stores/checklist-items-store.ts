'use client';

// FLUX-156: checklist_task_items local-first store. Mirrors grocery-items-store.ts.
// (Table named checklist_task_items to avoid the legacy checklist_items collision.)

import { createGroupStore } from '../create-group-store';
import type { ChecklistTaskItem } from '../../types';

export const checklistItems$ = createGroupStore<ChecklistTaskItem>({
  collection: 'checklist_task_items',
  storageName: 'checklist_task_items',
});
