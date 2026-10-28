'use client';

// One store's live rows for a slot source: the store opened for the group
// (undefined opens the inert one), kept in sync, and read only while the
// surface is active, so a closed sheet doesn't subscribe.

import { use$ } from '@legendapp/state/react';
import type { GroupStore } from '../data/create-group-store';
import { useReconnectSync } from '../data/create-group-store';

export function useSlotRows<T extends { deleted: boolean }>(
  store: GroupStore<T>,
  groupId: string | undefined,
  active = true,
): T[] {
  const store$ = store(groupId);
  useReconnectSync(store$ as never);
  return use$(() => (active ? Object.values(store$.get() ?? {}).filter((r): r is T => !!r && !(r as T).deleted) : []));
}
