import { describe, expect, it } from "vitest";
import { normalizeIdentifier } from "./identifier";

// HOUP-23: signup and signin must normalize identically, or an account
// created via one path becomes unreachable via the other.
describe("normalizeIdentifier", () => {
  it("passes a real email through unchanged", () => {
    expect(normalizeIdentifier("bob@example.com")).toBe("bob@example.com");
  });

  it("synthesizes an internal email for a bare username", () => {
    expect(normalizeIdentifier("bob")).toBe("bob@homeup.local");
  });

  it("trims surrounding whitespace before checking for @", () => {
    expect(normalizeIdentifier("  bob  ")).toBe("bob@homeup.local");
    expect(normalizeIdentifier("  bob@example.com  ")).toBe("bob@example.com");
  });
});
