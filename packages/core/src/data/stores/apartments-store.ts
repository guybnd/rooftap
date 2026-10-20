'use client';

// FLUX-150 slice 4: apartments local-first store. Mirrors recipes-store.ts.

import { createGroupStore } from '../create-group-store';
import type { Apartment } from '../../types';

export const apartments$ = createGroupStore<Apartment>({
  collection: 'apartments',
  storageName: 'apartments',
});
