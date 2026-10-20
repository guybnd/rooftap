import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// HOUP-292: the bypass route must self-gate to 404 in production unless
// ALLOW_AUTH_BYPASS=true is explicitly set — mint-a-session-from-static-
// password is a real account-takeover risk if it's ever reachable in prod.
const listUsersMock = vi.fn();
const createUserMock = vi.fn();
const generateLinkMock = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: {
        listUsers: listUsersMock,
        createUser: createUserMock,
        generateLink: generateLinkMock,
      },
    },
  }),
}));

const verifyOtpMock = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { verifyOtp: verifyOtpMock },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

function req(body: unknown): Request {
  return new Request("https://example.com/api/auth/bypass", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const originalNodeEnv = process.env.NODE_ENV;
const originalAllowBypass = process.env.ALLOW_AUTH_BYPASS;
const originalUsername = process.env.BYPASS_USERNAME;
const originalPassword = process.env.BYPASS_PASSWORD;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BYPASS_USERNAME = "devadmin";
  process.env.BYPASS_PASSWORD = "devpass";
});

afterEach(() => {
  vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
  if (originalAllowBypass === undefined) delete process.env.ALLOW_AUTH_BYPASS;
  else process.env.ALLOW_AUTH_BYPASS = originalAllowBypass;
  if (originalUsername === undefined) delete process.env.BYPASS_USERNAME;
  else process.env.BYPASS_USERNAME = originalUsername;
  if (originalPassword === undefined) delete process.env.BYPASS_PASSWORD;
  else process.env.BYPASS_PASSWORD = originalPassword;
});

describe("POST /api/auth/bypass", () => {
  it("404s in production without ALLOW_AUTH_BYPASS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ALLOW_AUTH_BYPASS;
    const { POST } = await import("./route");

    const res = await POST(req({ username: "devadmin", password: "devpass" }));

    expect(res.status).toBe(404);
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it("proceeds past the gate in production when ALLOW_AUTH_BYPASS=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ALLOW_AUTH_BYPASS = "true";
    listUsersMock.mockResolvedValue({ data: { users: [] } });
    createUserMock.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    generateLinkMock.mockResolvedValue({
      data: { properties: { action_link: "https://example.com/?token_hash=abc" } },
      error: null,
    });
    verifyOtpMock.mockResolvedValue({ error: null });
    const { POST } = await import("./route");

    const res = await POST(req({ username: "devadmin", password: "devpass" }));

    expect(res.status).toBe(200);
    expect(listUsersMock).toHaveBeenCalled();
  });

  it("proceeds past the gate outside production and still 503s when bypass env vars are absent", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.BYPASS_USERNAME;
    delete process.env.BYPASS_PASSWORD;
    const { POST } = await import("./route");

    const res = await POST(req({ username: "devadmin", password: "devpass" }));

    expect(res.status).toBe(503);
  });

  it("still functions (mints a session) outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    listUsersMock.mockResolvedValue({ data: { users: [] } });
    createUserMock.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    generateLinkMock.mockResolvedValue({
      data: { properties: { action_link: "https://example.com/?token_hash=abc" } },
      error: null,
    });
    verifyOtpMock.mockResolvedValue({ error: null });
    const { POST } = await import("./route");

    const res = await POST(req({ username: "devadmin", password: "devpass" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, redirect: "/" });
  });

  it("401s on wrong credentials without touching Supabase", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { POST } = await import("./route");

    const res = await POST(req({ username: "devadmin", password: "wrong-password" }));

    expect(res.status).toBe(401);
    expect(listUsersMock).not.toHaveBeenCalled();
  });
});
