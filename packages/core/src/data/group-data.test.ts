import { describe, expect, it, vi } from "vitest";
import { fetchGroupData, isAuthUnavailable } from "./group-data";

// FLUX-1549: fetchAll must only take the "keep cached data" path for a
// network/refresh failure, never for a genuine sign-out — getting this
// classification backwards either blanks the app on a flaky connection or
// strands a truly-signed-out user in a stale group.
describe("isAuthUnavailable", () => {
  it("is false for a clean no-session (no error at all)", () => {
    expect(isAuthUnavailable(null)).toBe(false);
    expect(isAuthUnavailable(undefined)).toBe(false);
  });

  it("is true for a thrown fetch failure", () => {
    expect(isAuthUnavailable(new TypeError("Failed to fetch"))).toBe(true);
    expect(isAuthUnavailable({ message: "NetworkError when attempting to fetch resource." })).toBe(true);
    expect(isAuthUnavailable({ message: "The operation timed out" })).toBe(true);
  });

  it("is true for retryable auth HTTP statuses", () => {
    expect(isAuthUnavailable({ status: 401, message: "invalid JWT" })).toBe(true);
    expect(isAuthUnavailable({ status: 429, message: "rate limited" })).toBe(true);
    expect(isAuthUnavailable({ status: 503, message: "service unavailable" })).toBe(true);
  });

  it("is false for a genuine non-retryable auth error", () => {
    expect(isAuthUnavailable({ status: 400, message: "invalid_grant" })).toBe(false);
    expect(isAuthUnavailable({ status: 403, message: "user not found" })).toBe(false);
  });
});

type QueryResult = { data: unknown; error: unknown };

const EMPTY: QueryResult = { data: [], error: null };

function makeQueryBuilder(defaultResult: QueryResult, singleResult?: QueryResult, maybeSingleResult?: QueryResult) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(singleResult ?? defaultResult)),
    maybeSingle: vi.fn(() => Promise.resolve(maybeSingleResult ?? defaultResult)),
    then: (resolve: (v: QueryResult) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(defaultResult).then(resolve, reject),
  };
  return builder;
}

interface MockSupabaseOpts {
  getUser: () => Promise<unknown>;
  membership?: { group_id: string; role: string } | null;
  group?: Record<string, unknown> | null;
  members?: { user_id: string }[];
  sentInvitations?: unknown[];
  memberProfiles?: { id: string; email: string; display_name: string; avatar_url: string }[];
  prelimScoresError?: unknown;
  newGroupId?: string;
  membershipError?: unknown;
  groupInsertError?: unknown;
  groupSelectError?: unknown;
  memberInsertError?: unknown;
  profileError?: unknown;
  groupModules?: unknown[];
  groupModulesError?: unknown;
}

function makeSupabaseMock(opts: MockSupabaseOpts) {
  const {
    getUser,
    membership = null,
    group = null,
    members = [],
    sentInvitations = [],
    memberProfiles = [],
    prelimScoresError = null,
    newGroupId = "new-group-1",
    membershipError = null,
    groupInsertError = null,
    groupSelectError = null,
    memberInsertError = null,
    profileError = null,
    groupModules = [],
    groupModulesError = null,
  } = opts;

  const tableBuilders: Record<string, () => unknown> = {
    apartment_preliminary_scores: () =>
      makeQueryBuilder(prelimScoresError ? { data: null, error: prelimScoresError } : { data: [], error: null }),
    user_settings: () => makeQueryBuilder(EMPTY, undefined, { data: null, error: null }),
    group_members: () =>
      makeQueryBuilder(
        memberInsertError ? { data: null, error: memberInsertError } : { data: members, error: null },
        undefined,
        { data: membership, error: membershipError }
      ),
    group_invitations: () => makeQueryBuilder({ data: sentInvitations, error: null }),
    group_modules: () =>
      makeQueryBuilder(groupModulesError ? { data: null, error: groupModulesError } : { data: groupModules, error: null }),
    // The "groups" table serves two distinct .single() call sites in
    // fetchGroupData: the auto-create insert().select().single() and the
    // group-details select().eq().single(). Track whether insert() was
    // called on this builder instance so groupInsertError and
    // groupSelectError resolve independently instead of sharing one result.
    groups: () => {
      let insertCalled = false;
      const groupData = { data: group ?? { id: newGroupId, name: "My Group" }, error: null };
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        insert: vi.fn(() => {
          insertCalled = true;
          return builder;
        }),
        update: vi.fn(() => builder),
        upsert: vi.fn(() => builder),
        delete: vi.fn(() => builder),
        single: vi.fn(() =>
          Promise.resolve(
            insertCalled
              ? groupInsertError
                ? { data: null, error: groupInsertError }
                : groupData
              : groupSelectError
                ? { data: null, error: groupSelectError }
                : groupData
          )
        ),
        maybeSingle: vi.fn(() => Promise.resolve(EMPTY)),
        then: (resolve: (v: QueryResult) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(EMPTY).then(resolve, reject),
      };
      return builder;
    },
  };

  return {
    auth: { getUser },
    from: vi.fn((table: string) => (tableBuilders[table] ?? (() => makeQueryBuilder(EMPTY)))()),
    rpc: vi.fn(() => Promise.resolve(profileError ? { data: null, error: profileError } : { data: memberProfiles, error: null })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("fetchGroupData", () => {
  it("auto-creates a group for a signed-in user with no existing membership", async () => {
    const supabase = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      membership: null,
      group: { id: "new-group-1", name: "My Group" },
    });

    const result = await fetchGroupData(supabase);

    expect(result.authUnavailable).toBe(false);
    expect(result.currentUserId).toBe("user-1");
    expect(result.group).toEqual({ id: "new-group-1", name: "My Group" });
    expect(result.isGroupOwner).toBe(true);
  });

  it("clears group state for a genuine signed-out user (no membership, no auto-create)", async () => {
    const supabase = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    });

    const result = await fetchGroupData(supabase);

    expect(result.authUnavailable).toBe(false);
    expect(result.currentUserId).toBeNull();
    expect(result.group).toBeNull();
    expect(result.groupMembers).toEqual([]);
    expect(result.memberProfiles).toEqual({});
    expect(result.isGroupOwner).toBe(false);
    expect(result.sentInvitations).toEqual([]);
  });

  it("fetches sent invitations for an owner but not for a non-owner member", async () => {
    const ownerGroup = { id: "group-owner", name: "Owner Group" };
    const supabaseOwner = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: { id: "user-owner" } }, error: null }),
      membership: { group_id: "group-owner", role: "owner" },
      group: ownerGroup,
      members: [{ user_id: "user-owner" }],
      sentInvitations: [{ id: "inv-1" }],
      memberProfiles: [{ id: "user-owner", email: "owner@x.com", display_name: "Owner", avatar_url: "" }],
    });

    const ownerResult = await fetchGroupData(supabaseOwner);
    expect(ownerResult.isGroupOwner).toBe(true);
    expect(ownerResult.sentInvitations).toEqual([{ id: "inv-1" }]);
    expect(ownerResult.memberProfiles).toEqual({ "user-owner": { email: "owner@x.com", name: "Owner", avatar: null } });

    const memberGroup = { id: "group-member", name: "Member Group" };
    const supabaseMember = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: { id: "user-member" } }, error: null }),
      membership: { group_id: "group-member", role: "member" },
      group: memberGroup,
      members: [{ user_id: "user-member" }],
      sentInvitations: [{ id: "should-not-appear" }],
    });

    const memberResult = await fetchGroupData(supabaseMember);
    expect(memberResult.isGroupOwner).toBe(false);
    // Non-owners never issue the group_invitations query for sent invites — the
    // pending list stays empty regardless of what the table would return.
    expect(memberResult.sentInvitations).toEqual([]);
  });

  it("returns the household's module switches", async () => {
    const rows = [{ group_id: "g1", module_id: "groceries", enabled: true, updated_by: null, updated_at: "2026-10-18T00:00:00Z" }];
    const supabase = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      membership: { group_id: "g1", role: "owner" },
      group: { id: "g1", name: "Home" },
      groupModules: rows,
    });

    const result = await fetchGroupData(supabase);
    expect(result.groupModules).toEqual(rows);
    expect(result.fetchError).toBeUndefined();
  });

  it("reports module switches as unknown (null), not as a fetch error, when the table is missing", async () => {
    const supabase = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      membership: { group_id: "g1", role: "owner" },
      group: { id: "g1", name: "Home" },
      groupModulesError: { code: "42P01", message: 'relation "public.group_modules" does not exist' },
    });

    const result = await fetchGroupData(supabase);
    expect(result.groupModules).toBeNull();
    expect(result.hasMembership).toBe(true);
    expect(result.fetchError).toBeUndefined();
  });

  it("returns authUnavailable:true and no data for a retryable getUser error", async () => {
    const supabase = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: null }, error: { status: 503, message: "service unavailable" } }),
    });

    const result = await fetchGroupData(supabase);

    expect(result.authUnavailable).toBe(true);
    expect(result.group).toBeNull();
    expect(result.preliminaryScores).toBeNull();
  });

  it("returns preliminaryScores:null on a fetch error, leaving it to the caller to keep cached data", async () => {
    const supabase = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      prelimScoresError: { message: "boom" },
    });

    const result = await fetchGroupData(supabase);

    expect(result.authUnavailable).toBe(false);
    expect(result.preliminaryScores).toBeNull();
  });

  // HOUP-178: a genuine query failure must surface as fetchError, not
  // collapse into the same hasMembership:false shape as a real signed-out
  // user or a clean "no group yet" state.
  it("surfaces fetchError and skips auto-create when the membership lookup itself fails", async () => {
    const supabase = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      membershipError: { message: "membership lookup failed" },
    });

    const result = await fetchGroupData(supabase);

    expect(result.currentUserId).toBe("user-1");
    expect(result.fetchError).toBe("membership lookup failed");
    expect(result.hasMembership).toBe(false);
    expect(result.group).toBeNull();
    // The insert path (auto-create) must not fire on top of an unknown
    // membership state — that would risk creating a duplicate group for a
    // user whose real membership just couldn't be read.
    expect(supabase.from).not.toHaveBeenCalledWith("groups");
  });

  it("surfaces fetchError when the group auto-create insert fails", async () => {
    const supabase = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      membership: null,
      groupInsertError: { message: "insert failed" },
    });

    const result = await fetchGroupData(supabase);

    expect(result.fetchError).toBe("insert failed");
    expect(result.hasMembership).toBe(false);
    expect(result.group).toBeNull();
  });

  it("surfaces fetchError when the group-details fetch's .single() errors, while keeping hasMembership true", async () => {
    const supabase = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      membership: { group_id: "group-1", role: "owner" },
      groupSelectError: { message: "group select failed" },
    });

    const result = await fetchGroupData(supabase);

    expect(result.fetchError).toBe("group select failed");
    expect(result.hasMembership).toBe(true);
    expect(result.group).toBeNull();
  });

  it("surfaces fetchError from a failing get_member_profiles RPC while still returning group data", async () => {
    const group = { id: "group-1", name: "Group" };
    const supabase = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      membership: { group_id: "group-1", role: "owner" },
      group,
      members: [{ user_id: "user-1" }],
      profileError: { message: "rpc failed" },
    });

    const result = await fetchGroupData(supabase);

    expect(result.fetchError).toBe("rpc failed");
    expect(result.hasMembership).toBe(true);
    expect(result.group).toEqual(group);
    expect(result.memberProfiles).toEqual({});
  });
});
