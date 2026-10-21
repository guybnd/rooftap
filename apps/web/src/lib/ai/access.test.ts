import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// HOUP-436: resolveAiKey gathers decideAiKey's inputs (rule tested in core).
const keys = new Map<string, string>();
vi.mock("./household-keys", () => ({ householdKeys: async () => keys }));
let tier = "free";
let billing = "on";
vi.mock("@/lib/billing", () => ({ householdTier: async () => tier, billingMode: () => billing }));
vi.mock("@/lib/admin-config", () => ({ resolveParsingProvider: async () => "gemini" }));
let serverKey: string | undefined = "server-gemini";
vi.mock("./providers", () => ({ serverProviderKey: async () => serverKey }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const rpc = vi.fn(async () => ({ error: null }));
let reads = 0;
function admin(): SupabaseClient {
  const q = {
    select: () => q,
    eq: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: { group_id: "g1", reads }, error: null }),
  };
  return { from: () => q, rpc } as unknown as SupabaseClient;
}

beforeEach(() => {
  keys.clear();
  tier = "free";
  billing = "on";
  serverKey = "server-gemini";
  reads = 0;
  rpc.mockClear();
});

describe("resolveAiKey", () => {
  it("uses the household's own key and doesn't count the read", async () => {
    keys.set("openai", "sk-household");
    const { recordAiRead, resolveAiKey } = await import("./access");
    const key = await resolveAiKey("u1", "receipt", admin());
    expect(key).toEqual({ provider: "openai", apiKey: "sk-household", source: "household", groupId: "g1" });
    await recordAiRead(key, admin());
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks hosted Free without a key", async () => {
    const { AiBlockedError, resolveAiKey } = await import("./access");
    await expect(resolveAiKey("u1", "receipt", admin())).rejects.toBeInstanceOf(AiBlockedError);
  });

  it("counts a Plus read on the server's key, and stops at the allowance", async () => {
    tier = "plus";
    const { recordAiRead, resolveAiKey } = await import("./access");
    const key = await resolveAiKey("u1", "recipe", admin());
    expect(key.source).toBe("server");
    await recordAiRead(key, admin());
    expect(rpc).toHaveBeenCalledWith("ai_record_read", expect.objectContaining({ p_group_id: "g1" }));
    reads = 300;
    await expect(resolveAiKey("u1", "recipe", admin())).rejects.toMatchObject({ code: "ai_allowance_used" });
  });

  it("lets everyone use the server key with billing off", async () => {
    billing = "off";
    const { resolveAiKey } = await import("./access");
    expect((await resolveAiKey("u1", "event", admin())).apiKey).toBe("server-gemini");
  });
});
