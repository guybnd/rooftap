import { beforeEach, describe, expect, it, vi } from "vitest";

// HOUP-242: server-global config, gated on requireServerOperator (not group
// ownership) -- see src/lib/admin-auth.ts.
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
  return new Request("https://example.com/api/admin/parsing-provider", {
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

describe("GET /api/admin/parsing-provider", () => {
  it("a group owner who is not a server operator gets the gate's error, not provider data", async () => {
    const gateError = Response.json({ error: "Forbidden" }, { status: 403 });
    requireServerOperatorMock.mockResolvedValue({ error: gateError });
    const { GET } = await import("./route");

    const res = await GET();
    expect(res).toBe(gateError);
  });

  it("a server operator gets the provider status", async () => {
    const { GET } = await import("./route");

    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.provider).toBe("");
    expect(Array.isArray(json.providers)).toBe(true);
  });
});

describe("PUT /api/admin/parsing-provider", () => {
  it("a group owner who is not a server operator cannot change the provider", async () => {
    const gateError = Response.json({ error: "Forbidden" }, { status: 403 });
    requireServerOperatorMock.mockResolvedValue({ error: gateError });
    const { PUT } = await import("./route");

    const res = await PUT(req({ provider: "anthropic" }));
    expect(res).toBe(gateError);
    expect(setAdminConfigValueMock).not.toHaveBeenCalled();
  });

  it("a server operator can set a valid provider", async () => {
    const { PUT } = await import("./route");

    const res = await PUT(req({ provider: "anthropic" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(setAdminConfigValueMock).toHaveBeenCalledWith("AI_PARSING_PROVIDER", "anthropic");
  });
});
