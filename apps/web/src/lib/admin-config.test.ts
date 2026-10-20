import { describe, expect, it, vi, beforeEach } from "vitest";

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

import { resolveParsingProvider } from "@/lib/admin-config";

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
