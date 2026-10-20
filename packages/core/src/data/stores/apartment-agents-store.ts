'use client';

// FLUX-150 slice 4: apartment_agents (apartment <-> agent junction) local-first
// store. Mirrors recipes-store.ts. The `id` column is a surrogate primary key
// added in the 20260726000001 migration — Legend's SyncedRow contract requires
// a single-column id, which this junction table never had (it was a bare
// (apartment_id, agent_id) composite PK before).

import { createGroupStore } from '../create-group-store';
import type { ApartmentAgent } from '../../types';

export const apartmentAgents$ = createGroupStore<ApartmentAgent>({
  collection: 'apartment_agents',
  storageName: 'apartment_agents',
});
