'use client';

// FLUX-156: checklist_templates local-first store. Mirrors grocery-items-store.ts.

import { createGroupStore } from '../create-group-store';
import type { ChecklistTemplate } from '../../types';

export const checklistTemplates$ = createGroupStore<ChecklistTemplate>({
  collection: 'checklist_templates',
  storageName: 'checklist_templates',
});
