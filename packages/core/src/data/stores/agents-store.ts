'use client';

// FLUX-150 slice 4: agents local-first store. Mirrors recipes-store.ts.

import { createGroupStore } from '../create-group-store';
import type { Agent } from '../../types';

export const agents$ = createGroupStore<Agent>({
  collection: 'agents',
  storageName: 'agents',
});
