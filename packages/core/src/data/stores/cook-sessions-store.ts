'use client';

// Recipes v2 R2: `cook_sessions`, the recipes a person is cooking now. Rows
// are the person's own (RLS), so this store holds only theirs; web and phone
// share them. Mirrors meal-plan-store.ts.

import { createGroupStore } from '../create-group-store';
import type { CookSession } from '../../modules/recipes/cook';

export const cookSessions$ = createGroupStore<CookSession>({
  collection: 'cook_sessions',
  storageName: 'cook_sessions',
});
