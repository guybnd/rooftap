import { beforeEach, describe, expect, it, vi } from "vitest";

// HOUP-310: registration is open only until the first account exists, then
// GoTrue's own disable_signup closes the public /auth/v1/signup path. This
// route is the one remaining door — unauthenticated, but self-gated on
// "does any user already exist" via the same listUsers({page:1,perPage:1})
// count api/setup/status/route.ts uses. Unlike api/admin/users, there is no
// requireOwner() gate here, so the mock target is createAdminClient itself.
const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

function req(body: unknown): Request {
  return new Request("https://example.com/api/setup/first-user", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function adminStub(opts: { existingUserCount?: number; createUserError?: Error | null; createUserId?: string }) {
  const { existingUserCount = 0, createUserError = null, createUserId = "new-owner-id" } = opts;
  return {
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({
          data: { users: Array.from({ length: existingUserCount }, (_, i) => ({ id: `existing-${i}` })) },
          error: null,
        })),
        createUser: vi.fn(async () =>
          createUserError
            ? { data: { user: null }, error: createUserError }
            : { data: { user: { id: createUserId } }, error: null }
        ),
      },
    },
  };
}

beforeEach(() => {
  createAdminClientMock.mockReset();
});

describe("POST /api/setup/first-user", () => {
  it("400s when identifier is empty/whitespace-only, without calling listUsers or createUser", async () => {
    const admin = adminStub({});
    createAdminClientMock.mockReturnValue(admin);
    const { POST } = await import("./route");

    const res = await POST(req({ identifier: "   ", password: "sixchars" }));

    expect(res.status).toBe(400);
    expect(admin.auth.admin.listUsers).not.toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("400s when password is under 6 chars", async () => {
    const admin = adminStub({});
    createAdminClientMock.mockReturnValue(admin);
    const { POST } = await import("./route");

    const res = await POST(req({ identifier: "alice", password: "short" }));

    expect(res.status).toBe(400);
    expect(admin.auth.admin.listUsers).not.toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("409s when a user already exists, and never calls createUser", async () => {
    const admin = adminStub({ existingUserCount: 1 });
    createAdminClientMock.mockReturnValue(admin);
    const { POST } = await import("./route");

    const res = await POST(req({ identifier: "alice", password: "sixchars" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({ error: "Registration is closed" });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("201s on a fresh instance: normalizes a bare identifier to @homeup.local and returns userId + email", async () => {
    const admin = adminStub({ existingUserCount: 0, createUserId: "owner-1" });
    createAdminClientMock.mockReturnValue(admin);
    const { POST } = await import("./route");

    const res = await POST(req({ identifier: "alice", password: "sixchars" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.email).toBe("alice@homeup.local");
    expect(json.userId).toBe("owner-1");
    expect(admin.auth.admin.listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1 });
  });

  it("201s with an identifier that already contains @, passed through unchanged", async () => {
    const admin = adminStub({ existingUserCount: 0 });
    createAdminClientMock.mockReturnValue(admin);
    const { POST } = await import("./route");

    const res = await POST(req({ identifier: "alice@example.com", password: "sixchars" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.email).toBe("alice@example.com");
  });

  it("falls back to the identifier for full_name when displayName is blank/absent", async () => {
    const admin = adminStub({ existingUserCount: 0 });
    createAdminClientMock.mockReturnValue(admin);
    const { POST } = await import("./route");

    await POST(req({ identifier: "alice", password: "sixchars" }));

    expect(admin.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alice@homeup.local",
        password: "sixchars",
        email_confirm: true,
        user_metadata: expect.objectContaining({ full_name: "alice" }),
      })
    );
  });

  it("500s when createUser returns an error", async () => {
    const admin = adminStub({ existingUserCount: 0, createUserError: new Error("boom") });
    createAdminClientMock.mockReturnValue(admin);
    const { POST } = await import("./route");

    const res = await POST(req({ identifier: "alice", password: "sixchars" }));

    expect(res.status).toBe(500);
  });
});
