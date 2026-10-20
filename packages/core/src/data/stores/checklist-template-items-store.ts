'use client';

// FLUX-156: checklist_template_items local-first store. Mirrors grocery-items-store.ts.

import { createGroupStore } from '../create-group-store';
import type { ChecklistTemplateItem } from '../../types';

export const checklistTemplateItems$ = createGroupStore<ChecklistTemplateItem>({
  collection: 'checklist_template_items',
  storageName: 'checklist_template_items',
});
