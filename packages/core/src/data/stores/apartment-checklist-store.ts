'use client';

// FLUX-150 slice 6: the legacy apartment-scoring checklist (tables
// checklist_items/checklist_responses) — NOT the same feature as the /checklists
// section's checklist_task_items (see checklist-items-store.ts). Named
// apartmentChecklist* here to avoid re-using an export name already taken by
// that unrelated feature. Mirrors recipes-store.ts.

import { createGroupStore } from '../create-group-store';
import type { ChecklistItem, ChecklistResponse } from '../../types';

export const apartmentChecklistItems$ = createGroupStore<ChecklistItem>({
  collection: 'checklist_items',
  storageName: 'checklist_items',
});

export const apartmentChecklistResponses$ = createGroupStore<ChecklistResponse>({
  collection: 'checklist_responses',
  storageName: 'checklist_responses',
});
