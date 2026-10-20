import { beforeEach, describe, expect, it, vi } from "vitest";

// HOUP-242: the whole point of this suite is proving the two boundaries this
// ticket fixes: (1) requireServerOperator() grants nothing without
// SERVER_OPERATOR_EMAILS naming the caller's email — no DB row, admin API,
// or request input can substitute; (2) requireOwner(groupId) checks
// ownership of the SPECIFIC group requested, not "owner of something" (the
// regression case is a user who owns a different group and must still get
// 403 for the group they don't own).
const getSessionUserMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({ getSessionUser: getSessionUserMock }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminStub }));

let membershipRows: Array<{ group_id: string; role: string }>;

const adminStub = {
  from: (table: string) => {
    if (table !== "group_members") throw new Error(`Unexpected table ${table}`);
    return {
      // stub ignores the outer eq("user_id", ...) equality (the fixture,
      // membershipRows, is already scoped to a single user); the inner
      // eq(col, value) is what production always chains next -- either
      // eq("group_id", groupId) or eq("role", "owner") -- so filter generically.
      // maybeSingle() with 2+ matching rows and no .limit(1) mirrors
      // PostgREST's real behavior for that combination: data comes back
      // null (the query errors) rather than picking a row -- this is what
      // makes the multi-group-owner regression test below fail without the
      // .limit(1) fix.
      select: () => ({
        eq: () => ({
          eq: (col: "group_id" | "role", value: string) => {
            const matches = membershipRows.filter((m) => m[col] === value);
            const resolve = (rows: typeof matches) => ({
              data: rows.length === 1 ? rows[0] : null,
            });
            return {
              maybeSingle: async () => resolve(matches),
              limit: (n: number) => ({
                maybeSingle: async () => resolve(matches.slice(0, n)),
              }),
            };
          },
        }),
      }),
    };
  },
};

beforeEach(() => {
  getSessionUserMock.mockReset();
  membershipRows = [];
  delete process.env.SERVER_OPERATOR_EMAILS;
});

describe("requireServerOperator", () => {
  it("401s with no session user", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const { requireServerOperator } = await import("./admin-auth");

    const gate = await requireServerOperator();
    expect("error" in gate && gate.error.status).toBe(401);
  });

  it("403s a signed-in user when SERVER_OPERATOR_EMAILS is unset (no lockout, but no operator either)", async () => {
    getSessionUserMock.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    const { requireServerOperator } = await import("./admin-auth");

    const gate = await requireServerOperator();
    expect("error" in gate && gate.error.status).toBe(403);
  });

  it("403s a group owner whose email is not in the allowlist -- owning a group grants nothing here", async () => {
    process.env.SERVER_OPERATOR_EMAILS = "operator@example.com";
    getSessionUserMock.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    const { requireServerOperator } = await import("./admin-auth");

    const gate = await requireServerOperator();
    expect("error" in gate && gate.error.status).toBe(403);
  });

  it("200s (grants the gate) when the caller's email is in SERVER_OPERATOR_EMAILS, matched case-insensitively and trimmed", async () => {
    process.env.SERVER_OPERATOR_EMAILS = " Operator@Example.com , other@example.com";
    getSessionUserMock.mockResolvedValue({ id: "u1", email: "operator@example.com" });
    const { requireServerOperator } = await import("./admin-auth");

    const gate = await requireServerOperator();
    expect("error" in gate).toBe(false);
  });
});

describe("requireOwner", () => {
  it("401s with no session user", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const { requireOwner } = await import("./admin-auth");

    const gate = await requireOwner("group-1");
    expect("error" in gate && gate.error.status).toBe(401);
  });

  it("owner of the requested group -> succeeds and returns that groupId", async () => {
    getSessionUserMock.mockResolvedValue({ id: "u1" });
    membershipRows = [{ group_id: "group-1", role: "owner" }];
    const { requireOwner } = await import("./admin-auth");

    const gate = await requireOwner("group-1");
    expect("error" in gate).toBe(false);
    expect(!("error" in gate) && gate.groupId).toBe("group-1");
  });

  it("owner of a DIFFERENT group -> 403 for the requested group (the regression this ticket closes)", async () => {
    getSessionUserMock.mockResolvedValue({ id: "u1" });
    membershipRows = [{ group_id: "group-1", role: "owner" }];
    const { requireOwner } = await import("./admin-auth");

    const gate = await requireOwner("group-2");
    expect("error" in gate && gate.error.status).toBe(403);
  });

  it("member (not owner) of the requested group -> 403", async () => {
    getSessionUserMock.mockResolvedValue({ id: "u1" });
    membershipRows = [{ group_id: "group-1", role: "member" }];
    const { requireOwner } = await import("./admin-auth");

    const gate = await requireOwner("group-1");
    expect("error" in gate && gate.error.status).toBe(403);
  });

  it("a user who owns multiple groups gets a deterministic result for the SPECIFIC groupId requested", async () => {
    getSessionUserMock.mockResolvedValue({ id: "u1" });
    membershipRows = [
      { group_id: "group-1", role: "owner" },
      { group_id: "group-2", role: "owner" },
    ];
    const { requireOwner } = await import("./admin-auth");

    const gateOne = await requireOwner("group-1");
    const gateTwo = await requireOwner("group-2");
    expect(!("error" in gateOne) && gateOne.groupId).toBe("group-1");
    expect(!("error" in gateTwo) && gateTwo.groupId).toBe("group-2");
  });

  it("no groupId (GET's derive-server-side path) resolves the caller's owned group", async () => {
    getSessionUserMock.mockResolvedValue({ id: "u1" });
    membershipRows = [{ group_id: "group-1", role: "owner" }];
    const { requireOwner } = await import("./admin-auth");

    const gate = await requireOwner();
    expect(!("error" in gate) && gate.groupId).toBe("group-1");
  });

  it("no groupId, owner of 2+ groups -> resolves to one group deterministically, not a 403 (HOUP-268)", async () => {
    getSessionUserMock.mockResolvedValue({ id: "u1" });
    membershipRows = [
      { group_id: "group-1", role: "owner" },
      { group_id: "group-2", role: "owner" },
    ];
    const { requireOwner } = await import("./admin-auth");

    const gate = await requireOwner();
    expect("error" in gate).toBe(false);
    expect(!("error" in gate) && gate.groupId).toBe("group-1");
  });
});
