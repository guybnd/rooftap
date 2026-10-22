import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESK_ITEMS,
  DESK_COLS,
  DESK_GAP_PX,
  DESK_MIN_H,
  DESK_ROW_PX,
  mergeLayout,
  normalizeDeskItems,
  rowsForHeight,
} from "./desk-arrangement";

describe("normalizeDeskItems", () => {
  it("falls back to the default for nothing saved", () => {
    expect(normalizeDeskItems(null)).toEqual(DEFAULT_DESK_ITEMS);
    expect(normalizeDeskItems("junk")).toEqual(DEFAULT_DESK_ITEMS);
  });

  it("drops unknown, malformed and duplicate entries", () => {
    const saved = [
      { i: "groceries", x: 0, y: 0, w: 6, h: 100, fit: false },
      { i: "groceries", x: 6, y: 0, w: 6, h: 100 },
      { i: "nope", x: 0, y: 0, w: 4, h: 40 },
      { i: "budget", x: "a", y: 0, w: 4, h: 40 },
    ];
    const out = normalizeDeskItems(saved);
    expect(out[0]).toEqual({ i: "groceries", x: 0, y: 0, w: 6, h: 100, fit: false });
    expect(out.filter((it) => it.i === "groceries")).toHaveLength(1);
    expect(out.some((it) => it.i === "nope")).toBe(false);
  });

  it("keeps sizes inside the grid", () => {
    const [it] = normalizeDeskItems([{ i: "budget", x: 11, y: -5, w: 1, h: 2 }]);
    expect(it.w).toBeGreaterThanOrEqual(3);
    expect(it.x + it.w).toBeLessThanOrEqual(DESK_COLS);
    expect(it.y).toBe(0);
    expect(it.h).toBe(DESK_MIN_H);
  });

  it("adds a module the save never saw below everything else", () => {
    const saved = DEFAULT_DESK_ITEMS.filter((d) => d.i !== "assistant");
    const out = normalizeDeskItems(saved);
    const floor = Math.max(...saved.map((d) => d.y + d.h));
    expect(out.find((d) => d.i === "assistant")!.y).toBeGreaterThanOrEqual(floor);
  });

  it("keeps a fitting module's measured height", () => {
    const items = [{ i: "a", x: 0, y: 0, w: 4, h: 40, fit: true }];
    expect(mergeLayout(items, [{ i: "a", x: 4, y: 8, w: 6, h: 50 }])).toEqual([{ i: "a", x: 4, y: 8, w: 6, h: 40, fit: true }]);
  });
});

describe("rowsForHeight", () => {
  it("covers the content and its gap", () => {
    const rows = rowsForHeight(301);
    expect(rows * DESK_ROW_PX).toBeGreaterThanOrEqual(301 + DESK_GAP_PX);
    expect((rows - 1) * DESK_ROW_PX).toBeLessThan(301 + DESK_GAP_PX);
  });

  it("never goes under the minimum", () => {
    expect(rowsForHeight(0)).toBe(DESK_MIN_H);
  });

  it("keeps a fitting module's measured height", () => {
    const items = [{ i: "a", x: 0, y: 0, w: 4, h: 40, fit: true }];
    expect(mergeLayout(items, [{ i: "a", x: 4, y: 8, w: 6, h: 50 }])).toEqual([{ i: "a", x: 4, y: 8, w: 6, h: 40, fit: true }]);
  });
});

describe("mergeLayout", () => {
  it("takes positions from the grid and keeps fit", () => {
    const items = [{ i: "a", x: 0, y: 0, w: 4, h: 40, fit: false }];
    expect(mergeLayout(items, [{ i: "a", x: 4, y: 8, w: 6, h: 50 }])).toEqual([{ i: "a", x: 4, y: 8, w: 6, h: 50, fit: false }]);
  });

  it("keeps a fitting module's measured height", () => {
    const items = [{ i: "a", x: 0, y: 0, w: 4, h: 40, fit: true }];
    expect(mergeLayout(items, [{ i: "a", x: 4, y: 8, w: 6, h: 50 }])).toEqual([{ i: "a", x: 4, y: 8, w: 6, h: 40, fit: true }]);
  });
});
