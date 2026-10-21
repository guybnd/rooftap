import { afterEach, describe, expect, it, vi } from "vitest";
import { canStoreHouseholdKeys, decryptHouseholdKey, encryptHouseholdKey } from "./household-keys";

afterEach(() => vi.unstubAllEnvs());

describe("household AI key encryption (HOUP-436)", () => {
  it("round-trips a key and never stores it in clear", () => {
    vi.stubEnv("HOUSEHOLD_KEYS_SECRET", "a-long-enough-test-secret");
    const stored = encryptHouseholdKey("sk-test-1234567890abcdef");
    expect(stored).not.toContain("sk-test");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptHouseholdKey(stored)).toBe("sk-test-1234567890abcdef");
  });

  it("uses a fresh IV each time", () => {
    vi.stubEnv("HOUSEHOLD_KEYS_SECRET", "a-long-enough-test-secret");
    expect(encryptHouseholdKey("same")).not.toBe(encryptHouseholdKey("same"));
  });

  it("reads nothing under a different secret, or a tampered value", () => {
    vi.stubEnv("HOUSEHOLD_KEYS_SECRET", "a-long-enough-test-secret");
    const stored = encryptHouseholdKey("sk-test-1234567890abcdef");
    const [v, iv, tag, body] = stored.split(":");
    expect(decryptHouseholdKey([v, iv, tag, Buffer.from("x" + body).toString("base64")].join(":"))).toBeNull();
    vi.stubEnv("HOUSEHOLD_KEYS_SECRET", "another-long-enough-secret");
    expect(decryptHouseholdKey(stored)).toBeNull();
  });

  it("can't store keys without a secret", () => {
    vi.stubEnv("HOUSEHOLD_KEYS_SECRET", "");
    expect(canStoreHouseholdKeys()).toBe(false);
    expect(() => encryptHouseholdKey("sk")).toThrow("HOUSEHOLD_KEYS_SECRET");
  });
});
