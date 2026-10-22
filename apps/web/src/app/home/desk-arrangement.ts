// Hearth §13.7 "Desktop shell" (Guy, 2026-10-22): on a wide screen Home is a
// free 12-column grid of modules. In Arrange you drag a module by its grip
// and resize it from its edges, at its real size. A module fits its content
// until you give it a height; then it keeps that height and scrolls inside.
// The arrangement is a per-browser choice like the layout switch itself,
// kept in localStorage.

export const DESK_COLS = 12;
/** One grid row (px). Small, so heights step smoothly. */
export const DESK_ROW_PX = 4;
/** The gap under each module (px), drawn inside the item so rows stay fine-grained. */
export const DESK_GAP_PX = 20;
/** Narrowest a module may get (columns) and shortest (rows). */
export const DESK_MIN_W = 3;
export const DESK_MIN_H = 20;

export interface DeskItem {
  /** The module id. */
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Height follows the content. False once someone sets a height by hand. */
  fit: boolean;
}

// v2: Guy's arrangement became the default (2026-10-22), so older saves start over on it.
export const DESK_ARRANGEMENT_STORAGE_KEY = "homeup-desktop-home-grid-v2";

/**
 * Two lanes to start: the summary, the week board and the spaces that read
 * well wide on the left; Groceries leads the right lane in a long slot.
 * Heights are placeholders until the content is measured.
 */
export const DEFAULT_DESK_ITEMS: DeskItem[] = [
  // Left lane: the day, then the week board at a set height (it scrolls inside).
  { i: "summary", x: 0, y: 0, w: 8, h: 80, fit: true },
  { i: "board", x: 0, y: 80, w: 8, h: 170, fit: false },
  // Under the board, two half-width columns of the smaller spaces.
  { i: "shopper", x: 0, y: 250, w: 4, h: 45, fit: true },
  { i: "assistant", x: 0, y: 295, w: 4, h: 30, fit: true },
  { i: "setup", x: 4, y: 250, w: 4, h: 35, fit: true },
  { i: "search", x: 4, y: 285, w: 4, h: 40, fit: true },
  // Right lane: the lists you check most. Groceries keeps a set height and
  // scrolls its whole list inside.
  { i: "groceries", x: 8, y: 0, w: 4, h: 150, fit: false },
  { i: "budget", x: 8, y: 140, w: 4, h: 85, fit: true },
  { i: "bills", x: 8, y: 225, w: 4, h: 85, fit: true },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A saved arrangement made whole: unknown or malformed entries drop out,
 * duplicates keep the first, sizes stay inside the grid, and a module the save
 * never saw (a new one) joins at its default column under everything else.
 */
export function normalizeDeskItems(saved: unknown, defaults: DeskItem[] = DEFAULT_DESK_ITEMS): DeskItem[] {
  const byId = new Map(defaults.map((d) => [d.i, d]));
  const seen = new Set<string>();
  const out: DeskItem[] = [];
  for (const raw of Array.isArray(saved) ? saved : []) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<DeskItem>;
    if (typeof r.i !== "string" || !byId.has(r.i) || seen.has(r.i)) continue;
    if (![r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    seen.add(r.i);
    const w = clamp(Math.round(r.w!), DESK_MIN_W, DESK_COLS);
    out.push({
      i: r.i,
      w,
      x: clamp(Math.round(r.x!), 0, DESK_COLS - w),
      y: Math.max(0, Math.round(r.y!)),
      h: Math.max(DESK_MIN_H, Math.round(r.h!)),
      fit: r.fit !== false,
    });
  }
  const floor = out.reduce((m, it) => Math.max(m, it.y + it.h), 0);
  for (const d of defaults) if (!seen.has(d.i)) out.push({ ...d, y: floor + d.y });
  return out;
}

/** Grid rows a module needs to show `contentPx` of content plus its gap. */
export function rowsForHeight(contentPx: number): number {
  return Math.max(DESK_MIN_H, Math.ceil((contentPx + DESK_GAP_PX) / DESK_ROW_PX));
}

/** Folds a grid's reported layout back into our items, keeping each one's fit flag. */
export function mergeLayout(items: DeskItem[], layout: readonly { i: string; x: number; y: number; w: number; h: number }[]): DeskItem[] {
  const next = new Map(layout.map((l) => [l.i, l]));
  return items.map((it) => {
    const l = next.get(it.i);
    // A fitting module's height is its content's, never the grid's echo of an older one.
    return l ? { ...it, x: l.x, y: l.y, w: l.w, h: it.fit ? it.h : l.h } : it;
  });
}

export function readDeskItems(): DeskItem[] {
  try {
    const raw = window.localStorage.getItem(DESK_ARRANGEMENT_STORAGE_KEY);
    return normalizeDeskItems(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_DESK_ITEMS;
  }
}

export function saveDeskItems(items: DeskItem[] | null) {
  try {
    if (items) window.localStorage.setItem(DESK_ARRANGEMENT_STORAGE_KEY, JSON.stringify(items));
    else window.localStorage.removeItem(DESK_ARRANGEMENT_STORAGE_KEY);
  } catch {
    // Storage blocked: the arrangement still applies until the tab closes.
  }
}
