import { beforeEach, describe, expect, it, vi } from "vitest";

// Drives getSessionUser()'s two-path contract end-to-end: the cookie-scoped
// client's auth.getUser() call and the Bearer-fallback anon client's
// auth.getUser(token) call are separately mockable, so we can assert which
// path actually ran (HOUP-100 acceptance criteria).
const cookieGetUserMock = vi.fn();
const bearerGetUserMock = vi.fn();
const headersGetMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: cookieGetUserMock } }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: bearerGetUserMock } }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: vi.fn() }),
  headers: async () => ({ get: headersGetMock }),
}));

const { getSessionUser } = await import("./session");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

describe("getSessionUser cookie path", () => {
  it("returns the cookie user without consulting the Authorization header", async () => {
    cookieGetUserMock.mockResolvedValue({ data: { user: { id: "user-cookie" } } });

    await expect(getSessionUser()).resolves.toEqual({ id: "user-cookie" });
    expect(headersGetMock).not.toHaveBeenCalled();
    expect(bearerGetUserMock).not.toHaveBeenCalled();
  });
});

describe("getSessionUser Bearer fallback (no cookie user)", () => {
  it("resolves to the user for a valid Bearer token", async () => {
    cookieGetUserMock.mockResolvedValue({ data: { user: null } });
    headersGetMock.mockReturnValue("Bearer valid-access-token");
    bearerGetUserMock.mockResolvedValue({ data: { user: { id: "user-bearer" } } });

    await expect(getSessionUser()).resolves.toEqual({ id: "user-bearer" });
    expect(bearerGetUserMock).toHaveBeenCalledWith("valid-access-token");
  });

  it("returns null for an invalid/expired Bearer token", async () => {
    cookieGetUserMock.mockResolvedValue({ data: { user: null } });
    headersGetMock.mockReturnValue("Bearer expired-token");
    bearerGetUserMock.mockResolvedValue({ data: { user: null } });

    await expect(getSessionUser()).resolves.toBeNull();
  });

  it("returns null with no cookie and no Authorization header", async () => {
    cookieGetUserMock.mockResolvedValue({ data: { user: null } });
    headersGetMock.mockReturnValue(null);

    await expect(getSessionUser()).resolves.toBeNull();
    expect(bearerGetUserMock).not.toHaveBeenCalled();
  });

  it("returns null for a non-Bearer scheme (no DB/Auth-server call)", async () => {
    cookieGetUserMock.mockResolvedValue({ data: { user: null } });
    headersGetMock.mockReturnValue("Basic abc123");

    await expect(getSessionUser()).resolves.toBeNull();
    expect(bearerGetUserMock).not.toHaveBeenCalled();
  });

  it("returns null for 'Bearer' with no token", async () => {
    cookieGetUserMock.mockResolvedValue({ data: { user: null } });
    headersGetMock.mockReturnValue("Bearer");

    await expect(getSessionUser()).resolves.toBeNull();
    expect(bearerGetUserMock).not.toHaveBeenCalled();
  });
});
