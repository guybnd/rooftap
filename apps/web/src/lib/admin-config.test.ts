import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// resolveParsingProvider (HOUP-43) reads AI_PARSING_PROVIDER via
// getAdminConfigValue, which goes through createAdminClient — mock the
// admin_config table so we control what's "stored" per test.
let storedValue: string | undefined;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "admin_config") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: storedValue != null ? { value: storedValue } : null, error: null }),
          }),
        }),
      };
    },
  }),
}));

import { openAdminConfigValue, resolveParsingProvider, sealAdminConfigValue } from "@/lib/admin-config";

describe("resolveParsingProvider", () => {
  beforeEach(() => {
    storedValue = undefined;
  });

  it("unset AI_PARSING_PROVIDER falls back to the legacy per-type default", async () => {
    expect(await resolveParsingProvider("listing")).toBe("openai");
    expect(await resolveParsingProvider("receipt")).toBe("openai");
    expect(await resolveParsingProvider("recipe")).toBe("gemini");
  });

  it("a set, known provider applies uniformly to every parse type", async () => {
    storedValue = "anthropic";
    expect(await resolveParsingProvider("listing")).toBe("anthropic");
    expect(await resolveParsingProvider("receipt")).toBe("anthropic");
    expect(await resolveParsingProvider("recipe")).toBe("anthropic");
  });

  it("an unrecognized stored value falls back to the legacy per-type default", async () => {
    storedValue = "not-a-real-provider";
    expect(await resolveParsingProvider("listing")).toBe("openai");
    expect(await resolveParsingProvider("recipe")).toBe("gemini");
  });

  it("clearing back to an empty string (the UI's Default option) restores the legacy split", async () => {
    storedValue = "";
    expect(await resolveParsingProvider("listing")).toBe("openai");
    expect(await resolveParsingProvider("receipt")).toBe("openai");
    expect(await resolveParsingProvider("recipe")).toBe("gemini");
  });
});

describe("admin_config encryption at rest", () => {
  const secret = process.env.HOUSEHOLD_KEYS_SECRET;
  afterEach(() => {
    if (secret === undefined) delete process.env.HOUSEHOLD_KEYS_SECRET;
    else process.env.HOUSEHOLD_KEYS_SECRET = secret;
  });

  it("seals a value when the server has a secret, and opens it again", () => {
    process.env.HOUSEHOLD_KEYS_SECRET = "a-test-secret-of-enough-length";
    const sealed = sealAdminConfigValue("sk-live-123");
    expect(sealed.startsWith("enc:")).toBe(true);
    expect(sealed).not.toContain("sk-live-123");
    expect(openAdminConfigValue(sealed)).toBe("sk-live-123");
  });

  it("keeps clear text without a secret, and reads older clear values", () => {
    delete process.env.HOUSEHOLD_KEYS_SECRET;
    expect(sealAdminConfigValue("sk-live-123")).toBe("sk-live-123");
    expect(openAdminConfigValue("sk-live-123")).toBe("sk-live-123");
    expect(openAdminConfigValue(null)).toBeUndefined();
  });

  it("treats a value sealed under another secret as unset", () => {
    process.env.HOUSEHOLD_KEYS_SECRET = "a-test-secret-of-enough-length";
    const sealed = sealAdminConfigValue("sk-live-123");
    process.env.HOUSEHOLD_KEYS_SECRET = "a-different-secret-entirely";
    expect(openAdminConfigValue(sealed)).toBeUndefined();
  });
});
