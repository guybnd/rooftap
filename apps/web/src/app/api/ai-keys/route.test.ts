import { beforeEach, describe, expect, it, vi } from "vitest";

// HOUP-436: Settings > AI keys. Members see status, owners write, and the key
// itself is never sent back.
const getSessionUserMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({ getSessionUser: () => getSessionUserMock() }));

let role = "owner";
let stored: Record<string, unknown>[] = [];
const upserts: Record<string, unknown>[] = [];
const deletes: string[] = [];

function query(table: string) {
  const q = {
    select: () => q,
    eq: (col: string, value: string) => {
      if (table === "household_ai_keys" && col === "provider") deletes.push(value);
      return q;
    },
    limit: () => q,
    maybeSingle: async () => {
      if (table === "group_members") return { data: { group_id: "g1", role } };
      if (table === "ai_usage") return { data: { reads: 7 } };
      return { data: null };
    },
    upsert: async (row: Record<string, unknown>) => {
      upserts.push(row);
      return { error: null };
    },
    delete: () => q,
    then: (resolve: (v: unknown) => void) => resolve({ data: table === "household_ai_keys" ? stored : [], error: null }),
  };
  return q;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query }) }));

function req(method: string, body?: unknown, url = "https://example.com/api/ai-keys") {
  return new Request(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("HOUSEHOLD_KEYS_SECRET", "a-long-enough-test-secret");
  vi.stubEnv("ROOFTAP_BILLING", "on");
  getSessionUserMock.mockResolvedValue({ id: "u1" });
  role = "owner";
  stored = [];
  upserts.length = 0;
  deletes.length = 0;
});

describe("/api/ai-keys", () => {
  it("lists keys by their last four only", async () => {
    stored = [{ provider: "gemini", encrypted_key: "v1:secret", last4: "abcd", created_at: "2026-10-21T00:00:00Z" }];
    const { GET } = await import("./route");
    const json = await (await GET()).json();
    expect(json.keys).toEqual([{ provider: "gemini", last4: "abcd", createdAt: "2026-10-21T00:00:00Z" }]);
    expect(JSON.stringify(json)).not.toContain("v1:secret");
    expect(json).toMatchObject({ access: "none", isOwner: true, canStore: true, allowance: null });
  });

  it("stores an owner's key encrypted", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(req("PUT", { provider: "openai", key: " sk-test-1234567890abcdefgh " }));
    expect(res.status).toBe(200);
    expect(upserts[0]).toMatchObject({ group_id: "g1", provider: "openai", last4: "efgh", created_by: "u1" });
    expect(String(upserts[0].encrypted_key)).not.toContain("sk-test");
  });

  it("refuses a member who isn't an owner", async () => {
    role = "member";
    const { PUT, DELETE } = await import("./route");
    expect((await PUT(req("PUT", { provider: "openai", key: "sk-test-1234567890abcdefgh" }))).status).toBe(403);
    expect((await DELETE(req("DELETE", undefined, "https://example.com/api/ai-keys?provider=openai"))).status).toBe(403);
    expect(upserts).toEqual([]);
  });

  it("rejects an unknown provider or a non-key", async () => {
    const { PUT } = await import("./route");
    expect((await PUT(req("PUT", { provider: "acme", key: "sk-test-1234567890abcdefgh" }))).status).toBe(400);
    expect((await PUT(req("PUT", { provider: "openai", key: "nope" }))).status).toBe(400);
  });

  it("says when the server has no secret to store keys with", async () => {
    vi.stubEnv("HOUSEHOLD_KEYS_SECRET", "");
    const { PUT } = await import("./route");
    expect((await PUT(req("PUT", { provider: "openai", key: "sk-test-1234567890abcdefgh" }))).status).toBe(503);
  });

  it("removes a key", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(req("DELETE", undefined, "https://example.com/api/ai-keys?provider=gemini"));
    expect(res.status).toBe(200);
    expect(deletes).toEqual(["gemini"]);
  });
});
