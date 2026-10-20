import { describe, expect, it, vi, beforeEach } from "vitest";

// Mirrors src/lib/admin-config.test.ts's vi.mock structure, but mocks the
// extracted operator gate and the validator map directly instead of the
// Supabase client -- this route is a thin dispatcher over both. vi.hoisted
// is required since vi.mock factories are hoisted above regular imports.
// HOUP-242: this route is server-global config, gated on requireServerOperator
// (not group ownership) -- see src/lib/admin-auth.ts.
const { requireServerOperatorMock, resolveServerKeyMock, openaiValidatorMock, googlePairMock } = vi.hoisted(() => ({
  requireServerOperatorMock: vi.fn(),
  resolveServerKeyMock: vi.fn(),
  openaiValidatorMock: vi.fn(),
  googlePairMock: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireServerOperator: requireServerOperatorMock,
}));

vi.mock("@/lib/admin-config", () => ({
  resolveServerKey: resolveServerKeyMock,
}));

vi.mock("@homeup/core", () => ({
  KEY_VALIDATORS: {
    OPENAI_API_KEY: openaiValidatorMock,
  },
  testGoogleOAuthPair: googlePairMock,
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/keys/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/keys/test", () => {
  beforeEach(() => {
    requireServerOperatorMock.mockReset();
    resolveServerKeyMock.mockReset();
    openaiValidatorMock.mockReset();
    googlePairMock.mockReset();
    requireServerOperatorMock.mockResolvedValue({ user: { id: "u1" }, admin: {} });
  });

  it("unauthenticated/non-operator: the gate's error response passes through unchanged", async () => {
    const gateError = Response.json({ error: "Forbidden" }, { status: 403 });
    requireServerOperatorMock.mockResolvedValue({ error: gateError });

    const res = await POST(makeRequest({ key: "OPENAI_API_KEY" }));

    expect(res).toBe(gateError);
    expect(resolveServerKeyMock).not.toHaveBeenCalled();
  });

  it("unknown key in body -> 400", async () => {
    const res = await POST(makeRequest({ key: "NOT_A_REAL_KEY" }));
    expect(res.status).toBe(400);
    expect(resolveServerKeyMock).not.toHaveBeenCalled();
  });

  it("GOOGLE_CLIENT_ID resolves both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and calls testGoogleOAuthPair with both", async () => {
    resolveServerKeyMock.mockImplementation(async (key: string) =>
      key === "GOOGLE_CLIENT_ID" ? "the-client-id" : "the-client-secret"
    );
    googlePairMock.mockResolvedValue({ status: "valid" });

    const res = await POST(makeRequest({ key: "GOOGLE_CLIENT_ID" }));
    const json = await res.json();

    expect(resolveServerKeyMock).toHaveBeenCalledWith("GOOGLE_CLIENT_ID");
    expect(resolveServerKeyMock).toHaveBeenCalledWith("GOOGLE_CLIENT_SECRET");
    expect(googlePairMock).toHaveBeenCalledWith("the-client-id", "the-client-secret");
    expect(json).toEqual({ status: "valid" });
  });

  it("GOOGLE_CLIENT_ID with either half unresolved -> unsupported, without calling the pair probe", async () => {
    resolveServerKeyMock.mockImplementation(async (key: string) =>
      key === "GOOGLE_CLIENT_ID" ? "the-client-id" : undefined
    );

    const res = await POST(makeRequest({ key: "GOOGLE_CLIENT_ID" }));
    const json = await res.json();

    expect(googlePairMock).not.toHaveBeenCalled();
    expect(json.status).toBe("unsupported");
  });

  it("any other known key resolves the value and calls KEY_VALIDATORS[key], returning its TestResult", async () => {
    resolveServerKeyMock.mockResolvedValue("sk-resolved-value");
    openaiValidatorMock.mockResolvedValue({ status: "invalid" });

    const res = await POST(makeRequest({ key: "OPENAI_API_KEY" }));
    const json = await res.json();

    expect(resolveServerKeyMock).toHaveBeenCalledWith("OPENAI_API_KEY");
    expect(openaiValidatorMock).toHaveBeenCalledWith("sk-resolved-value");
    expect(json).toEqual({ status: "invalid" });
  });

  it("resolveServerKey returning undefined -> unsupported (not-set) WITHOUT calling the validator", async () => {
    resolveServerKeyMock.mockResolvedValue(undefined);

    const res = await POST(makeRequest({ key: "OPENAI_API_KEY" }));
    const json = await res.json();

    expect(openaiValidatorMock).not.toHaveBeenCalled();
    expect(json.status).toBe("unsupported");
  });
});
