import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isKeptFrom, type Group, type ShopperWant } from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";

// HOUP-434: the shared front half of every /api/shopper route: a signed-in
// user (cookie or Bearer), the shopper module on for their household, and,
// when a want is named, that want belonging to a household they're in.

export type ShopperRequest =
  | { error: NextResponse }
  | { admin: SupabaseClient; userId: string; group: Group; want: ShopperWant | null };

export async function shopperRequest(wantId?: string | null): Promise<ShopperRequest> {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const off = await requireModules(user.id, "shopper");
  if (off) return { error: off };

  const admin = createAdminClient();
  let groupId: string | null = null;
  let want: ShopperWant | null = null;
  if (wantId) {
    const { data } = await admin.from("shopper_wants").select("*").eq("id", wantId).eq("deleted", false).maybeSingle();
    // A watch kept from this person (a surprise gift, Occasions) doesn't exist for them.
    if (!data || isKeptFrom(data as ShopperWant, user.id)) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
    want = data as ShopperWant;
    groupId = want.group_id;
  }
  const membership = admin.from("group_members").select("group_id").eq("user_id", user.id);
  const { data: rows } = groupId ? await membership.eq("group_id", groupId).limit(1) : await membership.limit(1);
  const member = rows?.[0];
  if (!member) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  const { data: group } = await admin.from("groups").select("*").eq("id", member.group_id).single();
  if (!group) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { admin, userId: user.id, group: group as Group, want };
}

/** The household's member ids, for checking who a search or watch is kept from. */
export async function groupMemberIds(admin: SupabaseClient, groupId: string): Promise<string[]> {
  const { data } = await admin.from("group_members").select("user_id").eq("group_id", groupId);
  return ((data ?? []) as { user_id: string }[]).map((m) => m.user_id);
}
