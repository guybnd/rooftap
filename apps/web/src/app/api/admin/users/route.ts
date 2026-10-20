import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/admin-auth";

// Owner-only group member management: create a household member account
// directly (no SMTP invite round-trip) and manage existing members.
// The client-side "Users" panel gates itself on isGroupOwner, but that check
// is cosmetic — the real boundary is the shared requireOwner() gate
// (src/lib/admin-auth.ts), which every verb calls before touching data.
// HOUP-242: POST/DELETE take an explicit groupId (the caller must claim
// ownership of THAT group, not "some group") — GET has no request body to
// source one from, so it keeps deriving the caller's owned group server-side.

type MemberProfile = { id: string; email: string; display_name: string; avatar_url: string };

// Username-or-email normalizer (HOUP-23 hasn't landed a shared helper yet —
// inlined per the ticket's key decision; identical rule to
// src/app/api/auth/bypass/route.ts:29).
function normalizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  return trimmed.includes("@") ? trimmed : `${trimmed}@homeup.local`;
}

export async function GET() {
  const gate = await requireOwner();
  if ("error" in gate) return gate.error;
  const { admin, groupId } = gate;

  const { data: members, error } = await admin
    .from("group_members")
    .select("user_id, role, joined_at")
    .eq("group_id", groupId);
  if (error) {
    return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
  }

  const ids = (members ?? []).map((m) => m.user_id);
  const profiles: MemberProfile[] = ids.length
    ? ((await admin.rpc("get_member_profiles", { member_ids: ids })).data as MemberProfile[] | null) ?? []
    : [];
  const profileMap = new Map<string, MemberProfile>(profiles.map((p) => [p.id, p]));

  const result = (members ?? []).map((m) => {
    const profile = profileMap.get(m.user_id);
    return {
      userId: m.user_id,
      role: m.role,
      joinedAt: m.joined_at,
      displayName: profile?.display_name || profile?.email || m.user_id,
      email: profile?.email ?? null,
    };
  });

  return NextResponse.json({ members: result });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const groupId: string | undefined = body?.groupId;
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  const gate = await requireOwner(groupId);
  if ("error" in gate) return gate.error;
  const { admin } = gate;

  const identifier: string | undefined = body?.identifier;
  const password: string | undefined = body?.password;
  const displayName: string | undefined = body?.displayName;

  if (!identifier?.trim() || !password || password.length < 6) {
    return NextResponse.json(
      { error: "A username or email, and a password of at least 6 characters, are required" },
      { status: 400 }
    );
  }

  const email = normalizeIdentifier(identifier);
  const name = displayName?.trim() || identifier.trim();

  const { data: existing } = await admin.auth.admin.listUsers();
  if (existing?.users?.some((u) => u.email === email)) {
    return NextResponse.json({ error: "A user with that username or email already exists" }, { status: 409 });
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, username: identifier.trim() },
  });
  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? "Failed to create user" }, { status: 500 });
  }

  // handle_new_user_group() already gave the new auth user their own personal
  // "My Group" (role owner) via the on_auth_user_created trigger. That exists
  // for self-service signups who need somewhere to land, but an admin-created
  // member is being placed into an existing household, so the personal group
  // is dead weight that leaves them in two groups at once — and the active-
  // group lookup in packages/core then has to pick one. Drop it before the
  // real membership insert so there is only ever one group to resolve.
  //
  // `created.user.id` is a freshly minted auth user, so created_by can only
  // match the group the trigger just made; the id guard is belt-and-braces
  // against ever touching the caller's household on an unfiltered delete.
  const { error: cleanupError } = await admin
    .from("groups")
    .delete()
    .eq("created_by", created.user.id)
    .neq("id", groupId);
  if (cleanupError) {
    // Non-fatal. Worst case the user keeps a stray empty group; the ordering
    // in fetchGroupData still resolves them into the household deterministically.
    console.error("Failed to remove auto-created personal group:", cleanupError);
  }

  // Add them to the caller's group as a member — the household they'll use.
  const { error: memberError } = await admin
    .from("group_members")
    .insert({ group_id: groupId, user_id: created.user.id, role: "member" });
  if (memberError) {
    return NextResponse.json(
      { error: "User was created but could not be added to your group" },
      { status: 500 }
    );
  }

  return NextResponse.json({ userId: created.user.id, email, password, displayName: name });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const groupId: string | undefined = body?.groupId;
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  const gate = await requireOwner(groupId);
  if ("error" in gate) return gate.error;
  const { admin, user } = gate;

  const userId: string | undefined = body?.userId;
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }
  if (userId === user.id) {
    return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 });
  }

  const { data: target } = await admin
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (target?.role === "owner") {
    return NextResponse.json({ error: "Cannot remove the group owner" }, { status: 400 });
  }

  const { error } = await admin
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) {
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
