// HOUP-129: pure reindex helper for the drag-to-reorder path. `ReorderableList`
// hands back the room's full next id order (already unfiltered — see
// `reorderGroupedByRoom` in setup/index.tsx); this turns that into contiguous
// 0..n `sort_order` writes. Extracted so the reindex logic is testable
// without a device — the drag gesture itself is Reanimated-worklet-driven and
// stays an on-device manual check.
export interface SortOrderPatch {
  id: string;
  sort_order: number;
}

export function reindexRoomOrder(nextOrderedIds: string[]): SortOrderPatch[] {
  return nextOrderedIds.map((id, index) => ({ id, sort_order: index }));
}
