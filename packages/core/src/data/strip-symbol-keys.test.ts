import { describe, expect, it } from "vitest";
import { stripSymbolKeys } from "./strip-symbol-keys";

// HOUP-7: regression coverage for the DataCloneError on delete-time sync
// reconciliation. Legend-State's realtime DELETE handler sets
// `old[symbolDelete] = true` before merging the row in; that symbol-keyed
// property must never reach IndexedDB's structured-clone-based `put`.
describe("stripSymbolKeys", () => {
  it("removes a symbol-keyed property from a plain object", () => {
    const symbolDelete = Symbol("delete");
    const row: Record<string | symbol, unknown> = { id: "1", name: "Milk" };
    row[symbolDelete] = true;

    const result = stripSymbolKeys(row);

    expect(result).toEqual({ id: "1", name: "Milk" });
    expect(Object.getOwnPropertySymbols(result)).toHaveLength(0);
  });

  it("strips symbol keys from nested objects and arrays", () => {
    const symbolDelete = Symbol("delete");
    const nested: Record<string | symbol, unknown> = { id: "2", label: "Eggs" };
    nested[symbolDelete] = true;
    const value = { items: [nested, { id: "3", label: "Bread" }] };

    const result = stripSymbolKeys(value);

    expect(result).toEqual({
      items: [{ id: "2", label: "Eggs" }, { id: "3", label: "Bread" }],
    });
  });

  it("returns the same reference when no symbol keys are present", () => {
    const value = { id: "1", nested: { a: 1 } };

    expect(stripSymbolKeys(value)).toBe(value);
  });

  it("passes through primitives and null unchanged", () => {
    expect(stripSymbolKeys(null)).toBeNull();
    expect(stripSymbolKeys(42)).toBe(42);
    expect(stripSymbolKeys("x")).toBe("x");
  });
});
