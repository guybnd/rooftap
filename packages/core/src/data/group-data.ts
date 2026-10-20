import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApartmentPreliminaryScore, Group, GroupInvitation, GroupMember, UserSettings } from "../types";
import type { GroupModuleRow } from "../modules";

// FLUX-1549: classify a Supabase getUser() failure as "auth unavailable"
// (network blip, unreachable auth server, expired token that failed to
// refresh) vs. a genuine sign-out. Only the former may be treated like
// offline (keep cached group); a clean no-user/no-error result still means
// signed-out and clears state as before. Mirrors the transient-error shape in
// src/lib/legend/create-group-store.ts's TRANSIENT_MESSAGE; kept as its own
// function rather than folded into fetchGroupData so it can be unit-tested
// without a Supabase client at all.
const TRANSIENT_AUTH_HTTP_STATUS = new Set([401, 408, 425, 429]);
const TRANSIENT_AUTH_MESSAGE =
  /failed to fetch|fetch failed|networkerror|network request failed|load failed|timed? ?out|aborted/i;

export function isAuthUnavailable(error: unknown): boolean {
  if (!error) return false;
  const err = error as { message?: string; status?: number };
  if (typeof err.status === "number" && (err.status >= 500 || TRANSIENT_AUTH_HTTP_STATUS.has(err.status))) return true;
  return TRANSIENT_AUTH_MESSAGE.test(String(err.message ?? ""));
}

// Reserved for future filter/param options — no caller needs one today.
export type FetchGroupDataOpts = Record<string, never>;

export interface FetchGroupDataResult {
  currentUserId: string | null;
  // true => caller should fall back to its offline cache, not clear state.
  authUnavailable: boolean;
  // false => no membership resolved (signed out, or the auto-create failed);
  // caller should clear group/groupMembers/memberProfiles/isGroupOwner/
  // sentInvitations rather than infer "no membership" from those being empty
  // (an existing membership can legitimately have an empty groupMembers/
  // sentInvitations, e.g. a group fetch that failed or a non-owner with no
  // pending invites).
  hasMembership: boolean;
  // The raw membership row (group_id/role) backing hasMembership — kept
  // separate from `group`/`isGroupOwner` because the group-details fetch can
  // fail independently of membership resolution (e.g. groups.select().single()
  // erroring while membership itself is known); callers persisting a
  // "membership" record want this even when `group` comes back null.
  membership: { group_id: string; role: string } | null;
  // HOUP-178: set when the membership lookup, the group auto-create insert,
  // or the get_member_profiles RPC genuinely errored (not "zero rows"). A
  // caller must not treat `hasMembership: false` alongside a set fetchError
  // as "signed in, no group" — the query failed and the real membership
  // state is unknown; keep whatever was previously painted and surface this
  // instead of silently collapsing to an empty/no-group screen.
  fetchError?: string;
  group: Group | null;
  groupMembers: GroupMember[];
  memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }>;
  isGroupOwner: boolean;
  sentInvitations: GroupInvitation[];
  // null = no signed-in user, or the pending-invitations query itself
  // errored; caller should leave its existing pendingInvitations state
  // untouched rather than clear it.
  pendingInvitations: GroupInvitation[] | null;
  userSettings: UserSettings | null;
  // null = the preliminary-scores fetch errored; caller keeps its cached data.
  preliminaryScores: ApartmentPreliminaryScore[] | null;
  // The household's module switches (.docs/modules.md). null = not fetched
  // (no membership) or the query errored, e.g. a self-hosted database that
  // hasn't applied the group_modules migration yet; the caller keeps its
  // cached rows, and with none cached treats every module as on.
  groupModules: GroupModuleRow[] | null;
}

// HOUP-72: pure Supabase read/auto-create/RPC sequence extracted from
// apps/web's data-cache.tsx fetchAll — no React state, no IndexedDB/
// localStorage writes. The caller (the DataCacheProvider in apps/web today,
// an Expo provider later) owns applying this result to its own state and
// persistence.
export async function fetchGroupData(
  supabase: SupabaseClient,
  _opts?: FetchGroupDataOpts
): Promise<FetchGroupDataResult> {
  const { data: authData, error: authError } = await supabase.auth
    .getUser()
    .catch((e: unknown) => ({ data: { user: null }, error: e }));

  if (authError && isAuthUnavailable(authError)) {
    return {
      currentUserId: null,
      authUnavailable: true,
      hasMembership: false,
      membership: null,
      group: null,
      groupMembers: [],
      memberProfiles: {},
      isGroupOwner: false,
      sentInvitations: [],
      pendingInvitations: null,
      userSettings: null,
      preliminaryScores: null,
      groupModules: null,
    };
  }

  const user = authData.user;

  const [prelimScoresRes, settingsRes, membershipRes, invitationsRes] = await Promise.all([
    supabase.from("apartment_preliminary_scores").select("*"),
    supabase.from("user_settings").select("*").maybeSingle(),
    user
      // A user should have exactly one membership, but a stray personal group
      // from the on_auth_user_created trigger can leave an older account with
      // two. Without an ORDER BY, .limit(1) picks whichever row Postgres
      // returns first, so the resolved group could flip between page loads.
      // Newest membership wins: the household someone was most recently added
      // to beats the personal group auto-created at signup.
      ? supabase.from("group_members").select("group_id, role").eq("user_id", user.id).order("joined_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Fetch pending invitations for this user in the same round — no serial dep on other results.
    user
      ? supabase.from("group_invitations").select("*, groups(name)").eq("invited_user_id", user.id).eq("status", "pending")
      : Promise.resolve({ data: [], error: null }),
  ]);

  let pendingInvitations: GroupInvitation[] | null = null;
  if (user && invitationsRes.data) {
    pendingInvitations = (invitationsRes.data ?? []).map((inv: Record<string, unknown>) => ({
      id: inv.id as string,
      group_id: inv.group_id as string,
      invited_by: inv.invited_by as string,
      invited_user_id: inv.invited_user_id as string,
      status: inv.status as "pending",
      created_at: inv.created_at as string,
      resolved_at: inv.resolved_at as string | null,
      group_name: (inv.groups as { name: string } | null)?.name ?? undefined,
    }));
  }

  let membership = membershipRes.data as { group_id: string; role: string } | null;

  // A genuinely failed lookup is not "no membership" — don't paper over it by
  // auto-creating a second group for a user who already has one.
  let fetchError: string | undefined;
  if (user && membershipRes.error) {
    fetchError = membershipRes.error.message;
  }

  if (!membership && user && !fetchError) {
    const { data: newGroup, error: groupInsertError } = await supabase
      .from("groups")
      .insert({ name: "My Group", created_by: user.id })
      .select()
      .single();
    if (newGroup) {
      const { error: memberInsertError } = await supabase
        .from("group_members")
        .insert({ group_id: newGroup.id, user_id: user.id, role: "owner" });
      if (memberInsertError) {
        fetchError = memberInsertError.message;
      } else {
        membership = { group_id: newGroup.id, role: "owner" };
      }
    } else if (groupInsertError) {
      fetchError = groupInsertError.message;
    }
  }

  let group: Group | null = null;
  let groupMembers: GroupMember[] = [];
  let memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }> = {};
  let isGroupOwner = false;
  let sentInvitations: GroupInvitation[] = [];
  let groupModules: GroupModuleRow[] | null = null;

  if (membership) {
    // Fetch group, members, sent invitations and module switches in parallel
    // — all only need membership.group_id / membership.role, not each other.
    const [groupRes, membersRes, sentInvRes, modulesRes] = await Promise.all([
      supabase.from("groups").select("*").eq("id", membership.group_id).single(),
      supabase.from("group_members").select("*").eq("group_id", membership.group_id),
      membership.role === "owner"
        ? supabase.from("group_invitations").select("*").eq("group_id", membership.group_id).eq("status", "pending")
        : Promise.resolve({ data: [], error: null }),
      supabase.from("group_modules").select("*").eq("group_id", membership.group_id),
    ]);
    // Not folded into fetchError: a missing table (older self-hosted
    // database) must not read as a failed membership lookup.
    groupModules = modulesRes.error ? null : ((modulesRes.data as GroupModuleRow[] | null) ?? []);
    const members = (membersRes.data as GroupMember[]) ?? [];
    const sentData: GroupInvitation[] = (sentInvRes.data as GroupInvitation[]) ?? [];

    if (groupRes.error) {
      fetchError = fetchError ?? groupRes.error.message;
    }

    const profiles: Record<string, { email: string; name: string | null; avatar: string | null }> = {};
    if (members.length > 0) {
      const { data: profileData, error: profileError } = await supabase.rpc("get_member_profiles", {
        member_ids: members.map((m) => m.user_id),
      });
      if (profileError) {
        fetchError = fetchError ?? profileError.message;
      } else if (profileData) {
        for (const p of profileData as { id: string; email: string; display_name: string; avatar_url: string }[]) {
          profiles[p.id] = {
            email: p.email || "",
            name: p.display_name || null,
            avatar: p.avatar_url || null,
          };
        }
      }
    }

    group = groupRes.data as Group | null;
    groupMembers = members;
    memberProfiles = profiles;
    isGroupOwner = membership.role === "owner";
    sentInvitations = sentData;
  }
  // else: no membership resolved (signed out, or the auto-create above
  // failed) — group/groupMembers/memberProfiles/isGroupOwner/sentInvitations
  // stay at their empty defaults above; the caller must clear any stale
  // painted state rather than let it linger.

  // A transient failure here must not blank previously-cached preliminary
  // scores — the caller keeps cached data when this is null.
  const preliminaryScores = prelimScoresRes.error
    ? null
    : ((prelimScoresRes.data as ApartmentPreliminaryScore[]) ?? []);

  return {
    currentUserId: user?.id ?? null,
    authUnavailable: false,
    hasMembership: membership !== null,
    membership,
    fetchError,
    group,
    groupMembers,
    memberProfiles,
    isGroupOwner,
    sentInvitations,
    pendingInvitations,
    userSettings: settingsRes.data as UserSettings | null,
    preliminaryScores,
    groupModules,
  };
}
