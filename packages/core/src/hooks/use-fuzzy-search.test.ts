import { describe, expect, it } from "vitest";
import Fuse from "fuse.js";
import { fuzzySearchGetFn } from "./use-fuzzy-search";

// HOUP-7: regression coverage for the undefined-key crash. The hook itself is
// a thin useMemo wrapper around Fuse — exercising Fuse directly with the
// guarded getFn reproduces the exact crash path without needing to render the
// React hook (no jsdom/testing-library in this repo's vitest setup).
describe("fuzzySearchGetFn", () => {
  it("does not throw when an item is missing a keyed field", () => {
    const items = [
      { id: "1", name: undefined as unknown as string, keywords: ["chicken", "broth"] },
      { id: "2", name: "chicken soup", keywords: undefined as unknown as string[] },
    ];

    expect(() => {
      const fuse = new Fuse(items, { keys: ["name", "keywords"], getFn: fuzzySearchGetFn });
      fuse.search("chicken");
    }).not.toThrow();
  });

  it("still matches array-valued keys normally", () => {
    const items = [{ id: "1", name: "soup", keywords: ["chicken", "broth"] }];
    const fuse = new Fuse(items, { keys: ["name", "keywords"], getFn: fuzzySearchGetFn });

    const results = fuse.search("chicken");

    expect(results.map((r) => r.item.id)).toContain("1");
  });

  it("resolves present values the same as Fuse's default resolver", () => {
    const item = { id: "1", name: "chicken soup" };
    expect(fuzzySearchGetFn(item, "name")).toBe("chicken soup");
  });
});
