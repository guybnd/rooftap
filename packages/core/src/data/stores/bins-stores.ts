'use client';

// Bin night module: the bin streams, the council's changes and the
// household's plan. Local-first like every group store, so bin night works
// with no signal.

import { createGroupStore } from '../create-group-store';
import type { BinChange, BinPlan, BinStream } from '../../modules/bins/bins';

export const binStreams$ = createGroupStore<BinStream>({
  collection: 'bin_streams',
  storageName: 'bin_streams',
});

export const binChanges$ = createGroupStore<BinChange>({
  collection: 'bin_changes',
  storageName: 'bin_changes',
});

export const binPlans$ = createGroupStore<BinPlan>({
  collection: 'bin_plans',
  storageName: 'bin_plans',
});
