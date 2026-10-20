import { beforeEach, describe, expect, it, vi } from "vitest";

// HOUP-242: server-global config, gated on requireServerOperator (not group
// ownership) -- see src/lib/admin-auth.ts. Mocks the gate + admin-config
// directly, mirroring keys/test/route.test.ts's thin-dispatcher style.
const { requireServerOperatorMock, getAdminConfigValueMock, setAdminConfigValueMock } = vi.hoisted(() => ({
  requireServerOperatorMock: vi.fn(),
  getAdminConfigValueMock: vi.fn(),
  setAdminConfigValueMock: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireServerOperator: requireServerOperatorMock,
}));

vi.mock("@/lib/admin-config", () => ({
  getAdminConfigValue: getAdminConfigValueMock,
  setAdminConfigValue: setAdminConfigValueMock,
}));

function req(body: unknown, method = "PUT"): Request {
  return new Request("https://example.com/api/admin/keys", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  requireServerOperatorMock.mockReset();
  getAdminConfigValueMock.mockReset();
  setAdminConfigValueMock.mockReset();
  requireServerOperatorMock.mockResolvedValue({ user: { id: "u1" }, admin: {} });
  getAdminConfigValueMock.mockResolvedValue(undefined);
});

describe("GET /api/admin/keys", () => {
  it("a group owner who is not a server operator gets the gate's 403, not key data", async () => {
    const gateError = Response.json({ error: "Forbidden" }, { status: 403 });
    requireServerOperatorMock.mockResolvedValue({ error: gateError });
    const { GET } = await import("./route");

    const res = await GET();
    expect(res).toBe(gateError);
  });

  it("never discloses a key value -- every entry has only isSet, no value field", async () => {
    getAdminConfigValueMock.mockResolvedValue("sk-super-secret-value");
    const { GET } = await import("./route");

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.keys.length).toBeGreaterThan(0);
    for (const entry of json.keys) {
      expect(entry).not.toHaveProperty("value");
      expect(typeof entry.isSet).toBe("boolean");
    }
  });
});

describe("PUT /api/admin/keys", () => {
  it("a group owner who is not a server operator cannot write a key", async () => {
    const gateError = Response.json({ error: "Forbidden" }, { status: 403 });
    requireServerOperatorMock.mockResolvedValue({ error: gateError });
    const { PUT } = await import("./route");

    const res = await PUT(req({ key: "OPENAI_API_KEY", value: "sk-new" }));
    expect(res).toBe(gateError);
    expect(setAdminConfigValueMock).not.toHaveBeenCalled();
  });

  it("a server operator can write a known runtime key", async () => {
    const { PUT } = await import("./route");

    const res = await PUT(req({ key: "OPENAI_API_KEY", value: "sk-new" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(setAdminConfigValueMock).toHaveBeenCalledWith("OPENAI_API_KEY", "sk-new");
  });
});
