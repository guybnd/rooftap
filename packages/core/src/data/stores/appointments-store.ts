'use client';

// FLUX-150 slice 5: appointments local-first store. Mirrors recipes-store.ts.

import { createGroupStore } from '../create-group-store';
import type { Appointment } from '../../types';

export const appointments$ = createGroupStore<Appointment>({
  collection: 'appointments',
  storageName: 'appointments',
});
