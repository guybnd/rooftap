import { beforeEach, describe, expect, it, vi } from "vitest";

// HOUP-154: this route's whole reason to exist is authenticating via the
// shared, Bearer-capable getSessionUser (see route.ts header) rather than the
// cookie-only helper subscribe/route.ts still uses — so the primary thing
// under test is that a Bearer-only caller (no cookie, exactly what native
// sends) succeeds, alongside the ordinary 401/400 branches.
const getSessionUserMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({ getSessionUser: getSessionUserMock }));

const createClientMock = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: (...args: unknown[]) => createClientMock(...args) }));

function adminStub(opts: {
  membership?: { group_id: string } | null;
  upsertError?: Error | null;
  deleteError?: Error | null;
}) {
  const { membership = { group_id: "group-1" }, upsertError = null, deleteError = null } = opts;
  return {
    from: (table: string) => {
      if (table === "group_members") {
        return { select: () => ({ eq: () => ({ limit: () => ({ single: async () => ({ data: membership }) }) }) }) };
      }
      if (table === "device_push_tokens") {
        return {
          upsert: async () => ({ error: upsertError }),
          delete: () => ({ eq: () => ({ eq: async () => ({ error: deleteError }) }) }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function req(body: unknown, method = "POST"): Request {
  return new Request("https://example.com/api/push/device-token", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
});

describe("POST /api/push/device-token", () => {
  it("401s with no session user (no cookie, no Bearer)", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const { POST } = await import("./route");

    const res = await POST(req({ expoPushToken: "ExponentPushToken[abc]", platform: "android" }));
    expect(res.status).toBe(401);
  });

  it("succeeds for a Bearer-authenticated caller (native's only auth path) and upserts scoped to the caller's group", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    const admin = adminStub({ membership: { group_id: "group-1" } });
    const upsertSpy = vi.spyOn(admin as unknown as { from: typeof admin.from }, "from");
    createClientMock.mockReturnValue(admin);
    const { POST } = await import("./route");

    const res = await POST(req({ expoPushToken: "ExponentPushToken[abc]", platform: "android", deviceId: "d1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(upsertSpy).toHaveBeenCalledWith("device_push_tokens");
  });

  it("400s on an invalid platform", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    createClientMock.mockReturnValue(adminStub({}));
    const { POST } = await import("./route");

    const res = await POST(req({ expoPushToken: "ExponentPushToken[abc]", platform: "windows" }));
    expect(res.status).toBe(400);
  });

  it("400s when the caller has no group", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    createClientMock.mockReturnValue(adminStub({ membership: null }));
    const { POST } = await import("./route");

    const res = await POST(req({ expoPushToken: "ExponentPushToken[abc]", platform: "ios" }));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/push/device-token", () => {
  it("401s with no session user", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const { DELETE } = await import("./route");

    const res = await DELETE(req({ expoPushToken: "ExponentPushToken[abc]" }, "DELETE"));
    expect(res.status).toBe(401);
  });

  it("removes the token, scoped to the caller's user id", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    createClientMock.mockReturnValue(adminStub({}));
    const { DELETE } = await import("./route");

    const res = await DELETE(req({ expoPushToken: "ExponentPushToken[abc]" }, "DELETE"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
  });

  it("400s on a missing token", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    createClientMock.mockReturnValue(adminStub({}));
    const { DELETE } = await import("./route");

    const res = await DELETE(req({}, "DELETE"));
    expect(res.status).toBe(400);
  });
});
