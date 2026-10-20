import { describe, expect, it } from "vitest";
import { formatRebuyInterval } from "./shelf-life-defaults";

describe("formatRebuyInterval", () => {
  it("returns null for null input", () => {
    expect(formatRebuyInterval(null)).toBeNull();
  });

  it.each([
    [0, "0d"],
    [6, "6d"],
    [7, "1w"],
    [10, "1w"],
    [29, "4w"],
    [30, "1mo"],
    [45, "2mo"],
    [364, "12mo"],
    [365, "1y"],
    [400, "1y"],
  ])("formats %i days as %s", (days, expected) => {
    expect(formatRebuyInterval(days)).toBe(expected);
  });
});
