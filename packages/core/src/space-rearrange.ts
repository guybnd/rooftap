// The More sheet's rearrange mode (Guy, Oct 21: "like iPhone home screen"):
// hold any space's tile and the grid starts to jiggle; drag a tile to a new
// spot. The grid is the household's section order, so the first slots ARE
// the tab bar (splitTabBar): dragging a space into them puts it in the bar,
// dragging one out sends it under More.
//
// Pure math shared by both sheets. Native evaluates the slot lookups on the
// UI thread (hence the 'worklet' directives, inert strings everywhere else).

/** Hold this long on a tile to start rearranging (same as holding a tab). */
export const REARRANGE_HOLD_MS = 450;

/** Tiles per row in the More sheet's grid. */
export const SPACE_GRID_COLUMNS = 4;

/** Height of one tile cell: an xl tile, the gap and a two-line label. */
export const SPACE_GRID_CELL_HEIGHT = 100;

// Worklet helpers come before every worklet that calls them (see tab-glide.ts).

/** Top-left corner of grid cell `index`. */
export function spaceGridCellOrigin(index: number, cellWidth: number): { x: number; y: number } {
  'worklet';
  return {
    x: (index % SPACE_GRID_COLUMNS) * cellWidth,
    y: Math.floor(index / SPACE_GRID_COLUMNS) * SPACE_GRID_CELL_HEIGHT,
  };
}

/**
 * The cell a dragged tile's centre (`x`, `y`, relative to the grid) sits
 * over, clamped into the grid's `count` cells so dragging past an edge
 * parks the tile at that end.
 */
export function spaceGridSlotAt(x: number, y: number, cellWidth: number, count: number): number {
  'worklet';
  if (count <= 0 || cellWidth <= 0) return 0;
  const col = Math.min(SPACE_GRID_COLUMNS - 1, Math.max(0, Math.floor(x / cellWidth)));
  const row = Math.max(0, Math.floor(y / SPACE_GRID_CELL_HEIGHT));
  return Math.min(count - 1, row * SPACE_GRID_COLUMNS + col);
}

/** Rows the grid needs for `count` tiles. */
export function spaceGridRows(count: number): number {
  return Math.ceil(count / SPACE_GRID_COLUMNS);
}

/** `list` with the item at `from` moved to `to` (the rest close up behind it). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/**
 * Saves a rearranged grid back into the full section order. The grid shows
 * only visible sections; hidden ones keep their own places in `order`, and
 * the visible places take `nextVisible` in its new sequence. Returns `order`
 * itself when nothing moved.
 */
export function reorderVisibleSections(order: string[], visible: string[], nextVisible: string[]): string[] {
  const shown = new Set(visible);
  const queue = nextVisible.filter((id) => shown.has(id));
  if (queue.length !== shown.size || queue.every((id, i) => id === visible[i])) return order;
  const next = order.map((id) => (shown.has(id) ? queue.shift()! : id));
  // A visible id the saved order never listed (a new module) goes on the end.
  return next.concat(queue);
}
