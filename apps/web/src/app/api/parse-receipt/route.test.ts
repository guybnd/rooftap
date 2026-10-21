import { beforeEach, describe, expect, it, vi } from "vitest";

// HOUP-216: this route now authenticates via the shared, Bearer-capable
// getSessionUser (matching /api/calendar/* and /api/push/device-token) so
// native can call it with an Authorization: Bearer token, not just a cookie
// session. The primary thing under test is that a Bearer-only caller
// succeeds and that a missing/invalid session still 401s.
const getSessionUserMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({ getSessionUser: getSessionUserMock }));

// The household's modules: Groceries on unless a test says otherwise.
const requireModulesMock = vi.fn();
vi.mock("@/lib/server-modules", () => ({ requireModules: (...args: unknown[]) => requireModulesMock(...args) }));

const parseReceiptFromImagesMock = vi.fn();
vi.mock("@/lib/ai/parser", () => ({ parseReceiptFromImages: (...args: unknown[]) => parseReceiptFromImagesMock(...args) }));

// HOUP-436: whose AI key pays. The real rule is core's decideAiKey (tested there).
const resolveAiKeyMock = vi.fn();
const recordAiReadMock = vi.fn();
vi.mock("@/lib/ai/access", async () => {
  const { NextResponse } = await import("next/server");
  class AiBlockedError extends Error {
    constructor(readonly code: string) {
      super(`blocked: ${code}`);
    }
  }
  return {
    AiBlockedError,
    aiBlockedResponse: (e: AiBlockedError) => NextResponse.json({ error: e.message, code: e.code }, { status: 402 }),
    resolveAiKey: (...args: unknown[]) => resolveAiKeyMock(...args),
    recordAiRead: (...args: unknown[]) => recordAiReadMock(...args),
  };
});
const SERVER_KEY = { provider: "gemini", apiKey: "k", source: "server", groupId: "g1" };

function req(body: unknown): Request {
  return new Request("https://example.com/api/parse-receipt", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireModulesMock.mockResolvedValue(null);
  resolveAiKeyMock.mockResolvedValue(SERVER_KEY);
});

describe("POST /api/parse-receipt", () => {
  it("401s with no session user (no cookie, no Bearer)", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const { POST } = await import("./route");

    const res = await POST(req({ images: ["data:image/png;base64,abc"] }));
    expect(res.status).toBe(401);
  });

  it("succeeds for a Bearer-authenticated caller (native's only auth path)", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    parseReceiptFromImagesMock.mockResolvedValue({ total: 42.5, retailer: "Woolworths" });
    const { POST } = await import("./route");

    const res = await POST(req({ images: ["data:image/png;base64,abc"] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ total: 42.5, retailer: "Woolworths" });
    expect(parseReceiptFromImagesMock).toHaveBeenCalledWith(["data:image/png;base64,abc"], SERVER_KEY);
    expect(recordAiReadMock).toHaveBeenCalledWith(SERVER_KEY);
  });

  it("404s without parsing when the household has Groceries off", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    const { NextResponse } = await import("next/server");
    requireModulesMock.mockResolvedValue(NextResponse.json({ error: "Not found" }, { status: 404 }));
    const { POST } = await import("./route");

    const res = await POST(req({ images: ["data:image/png;base64,abc"] }));
    expect(res.status).toBe(404);
    expect(requireModulesMock).toHaveBeenCalledWith("user-1", "groceries");
    expect(parseReceiptFromImagesMock).not.toHaveBeenCalled();
  });

  it("still succeeds for a cookie-session caller (web regression)", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    parseReceiptFromImagesMock.mockResolvedValue({ total: 10 });
    const { POST } = await import("./route");

    const res = await POST(req({ images: ["data:image/png;base64,abc"] }));
    expect(res.status).toBe(200);
  });

  it("400s when neither images nor pdf is provided", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    const { POST } = await import("./route");

    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("answers 402 with the code, without parsing, when the household may not use AI", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    const { AiBlockedError } = await import("@/lib/ai/access");
    resolveAiKeyMock.mockRejectedValue(new AiBlockedError("ai_requires_plus"));
    const { POST } = await import("./route");

    const res = await POST(req({ images: ["data:image/png;base64,abc"] }));
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("ai_requires_plus");
    expect(parseReceiptFromImagesMock).not.toHaveBeenCalled();
    expect(recordAiReadMock).not.toHaveBeenCalled();
  });
});
