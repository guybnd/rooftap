'use client';

// FLUX-150 slice 4/5: apartment_comments local-first store. Shared by Home
// Search (apartment detail) and Appointments (day-group comment thread).
// Mirrors recipes-store.ts.

import { createGroupStore } from '../create-group-store';
import type { ApartmentComment } from '../../types';

export const apartmentComments$ = createGroupStore<ApartmentComment>({
  collection: 'apartment_comments',
  storageName: 'apartment_comments',
});
