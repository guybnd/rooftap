import { beforeEach, describe, expect, it, vi } from "vitest";

// HOUP-242: POST/DELETE must be scoped to the SPECIFIC groupId the caller
// claims to own (not "owner of something") -- verified here by asserting
// requireOwner() is called with the groupId parsed from the request body,
// and that a missing groupId is rejected before any gate/database work.
// GET has no request body to source a groupId from, so it still calls
// requireOwner() with no argument (derives server-side).
const { requireOwnerMock } = vi.hoisted(() => ({
  requireOwnerMock: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireOwner: requireOwnerMock,
}));

function req(body: unknown, method: string): Request {
  return new Request("https://example.com/api/admin/users", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function adminStub(opts: {
  existingEmails?: string[];
  createUserError?: Error | null;
  insertError?: Error | null;
  /** Fails the personal-group cleanup, which must stay non-fatal. */
  cleanupError?: Error | null;
}) {
  const { existingEmails = [], createUserError = null, insertError = null, cleanupError = null } = opts;
  // Records the .delete().eq(...).neq(...) filters the personal-group cleanup
  // used, so a test can assert it never targets the caller's household.
  const groupDeletes: Array<Record<string, unknown>> = [];
  return {
    groupDeletes,
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: existingEmails.map((email) => ({ email })) } }),
        createUser: async () =>
          createUserError
            ? { data: { user: null }, error: createUserError }
            : { data: { user: { id: "new-user-id" } }, error: null },
      },
    },
    from: (table: string) => {
      // The route deletes the personal group handle_new_user_group()'s trigger
      // auto-creates, before adding the member to the real household.
      if (table === "groups") {
        return {
          delete: () => ({
            eq: (col: string, val: unknown) => ({
              neq: async (col2: string, val2: unknown) => {
                groupDeletes.push({ [col]: val, [`not_${col2}`]: val2 });
                return { error: cleanupError };
              },
            }),
          }),
        };
      }
      if (table !== "group_members") throw new Error(`Unexpected table ${table}`);
      return {
        insert: async () => ({ error: insertError }),
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { role: "member" } }) }),
            then: undefined,
          }),
        }),
        delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      };
    },
    rpc: async () => ({ data: [] }),
  };
}

beforeEach(() => {
  requireOwnerMock.mockReset();
});

describe("GET /api/admin/users", () => {
  it("derives the group server-side -- calls requireOwner() with no groupId argument", async () => {
    requireOwnerMock.mockResolvedValue({
      user: { id: "u1" },
      admin: { ...adminStub({}), from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }) },
      groupId: "group-1",
    });
    const { GET } = await import("./route");

    const res = await GET();
    expect(res.status).toBe(200);
    expect(requireOwnerMock).toHaveBeenCalledWith();
  });
});

describe("POST /api/admin/users", () => {
  it("400s when groupId is absent from the body, without touching the gate", async () => {
    const { POST } = await import("./route");

    const res = await POST(req({ identifier: "alice", password: "sixchars" }, "POST"));
    expect(res.status).toBe(400);
    expect(requireOwnerMock).not.toHaveBeenCalled();
  });

  it("passes the body's groupId to requireOwner(), and a non-owner-of-that-group gets the gate's 403", async () => {
    const gateError = Response.json({ error: "Forbidden" }, { status: 403 });
    requireOwnerMock.mockResolvedValue({ error: gateError });
    const { POST } = await import("./route");

    const res = await POST(req({ groupId: "group-not-owned", identifier: "alice", password: "sixchars" }, "POST"));
    expect(res).toBe(gateError);
    expect(requireOwnerMock).toHaveBeenCalledWith("group-not-owned");
  });

  it("owner of the requested group creates the user, scoped to that groupId", async () => {
    const admin = adminStub({});
    const insertSpy = vi.spyOn(admin, "from");
    requireOwnerMock.mockResolvedValue({ user: { id: "u1" }, admin, groupId: "group-1" });
    const { POST } = await import("./route");

    const res = await POST(
      req({ groupId: "group-1", identifier: "alice", password: "sixchars", displayName: "Alice" }, "POST")
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.email).toBe("alice@homeup.local");
    expect(insertSpy).toHaveBeenCalledWith("group_members");
  });

  it("deletes the auto-created personal group, never the caller's household", async () => {
    const admin = adminStub({});
    requireOwnerMock.mockResolvedValue({ user: { id: "u1" }, admin, groupId: "group-1" });
    const { POST } = await import("./route");

    const res = await POST(
      req({ groupId: "group-1", identifier: "alice", password: "sixchars" }, "POST")
    );

    expect(res.status).toBe(200);
    // Scoped to the brand-new user's own group, and explicitly not the
    // household the caller is adding them to.
    expect(admin.groupDeletes).toEqual([{ created_by: "new-user-id", not_id: "group-1" }]);
  });

  it("still creates the account when the personal-group cleanup fails", async () => {
    const admin = adminStub({ cleanupError: new Error("cleanup boom") });
    requireOwnerMock.mockResolvedValue({ user: { id: "u1" }, admin, groupId: "group-1" });
    const { POST } = await import("./route");

    const res = await POST(
      req({ groupId: "group-1", identifier: "alice", password: "sixchars" }, "POST")
    );

    // Non-fatal: the worst case is a stray empty group, which the membership
    // lookup's ordering already resolves around.
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/admin/users", () => {
  it("400s when groupId is absent from the body, without touching the gate", async () => {
    const { DELETE } = await import("./route");

    const res = await DELETE(req({ userId: "member-1" }, "DELETE"));
    expect(res.status).toBe(400);
    expect(requireOwnerMock).not.toHaveBeenCalled();
  });

  it("passes the body's groupId to requireOwner(), and a non-owner-of-that-group gets the gate's 403", async () => {
    const gateError = Response.json({ error: "Forbidden" }, { status: 403 });
    requireOwnerMock.mockResolvedValue({ error: gateError });
    const { DELETE } = await import("./route");

    const res = await DELETE(req({ groupId: "group-not-owned", userId: "member-1" }, "DELETE"));
    expect(res).toBe(gateError);
    expect(requireOwnerMock).toHaveBeenCalledWith("group-not-owned");
  });

  it("owner of the requested group removes a member scoped to that groupId", async () => {
    requireOwnerMock.mockResolvedValue({ user: { id: "u1" }, admin: adminStub({}), groupId: "group-1" });
    const { DELETE } = await import("./route");

    const res = await DELETE(req({ groupId: "group-1", userId: "member-1" }, "DELETE"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
  });
});
