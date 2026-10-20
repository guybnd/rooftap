import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSessionUser } from "@/lib/supabase/session";
import { createAdminClient } from "@/lib/supabase/admin";

// HOUP-25/HOUP-46/HOUP-242: two distinct gates for two distinct trust
// boundaries. requireServerOperator() protects server-global config (the
// admin_config table backing the API-keys panel and the parsing-provider
// setting) — operator status comes ONLY from the deploy-time
// SERVER_OPERATOR_EMAILS env var (see isServerOperator() below), never from
// admin_config, any other DB row, or any request input. requireOwner()
// protects per-group resources (group membership) and, when given a
// groupId, verifies ownership of that SPECIFIC group rather than "owner of
// something" — the bug this ticket fixes. The client panels self-gate on
// isGroupOwner/a 403 response (cosmetic), but these two functions are the
// real boundary.

type OwnerGateResult =
  | { error: NextResponse }
  | { user: User; admin: SupabaseClient; groupId: string };

type OperatorGateResult =
  | { error: NextResponse }
  | { user: User; admin: SupabaseClient };

function isServerOperator(user: User): boolean {
  const allowlist = process.env.SERVER_OPERATOR_EMAILS;
  if (!allowlist || !user.email) return false;
  const emails = allowlist
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return emails.includes(user.email.trim().toLowerCase());
}

export async function requireServerOperator(): Promise<OperatorGateResult> {
  const user = await getSessionUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  if (!isServerOperator(user)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user, admin: createAdminClient() };
}

// groupId omitted: "the group I own" — only GET /api/admin/users takes this
// path (it has no request body to source a groupId from). groupId given:
// ownership of that SPECIFIC group, verified deterministically by filtering
// on group_id + user_id rather than guessing via an unordered limit(1).
export async function requireOwner(groupId?: string): Promise<OwnerGateResult> {
  const user = await getSessionUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const query = admin.from("group_members").select("group_id, role").eq("user_id", user.id);
  const { data: membership } = groupId
    ? await query.eq("group_id", groupId).maybeSingle()
    : await query.eq("role", "owner").limit(1).maybeSingle();

  if (!membership || membership.role !== "owner") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user, admin, groupId: membership.group_id as string };
}
