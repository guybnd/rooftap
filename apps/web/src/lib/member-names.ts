import type { SupabaseClient } from "@supabase/supabase-js";

// Household members by first name, keyed by user id, for the assistant and
// the household tools. Names come from auth, one admin call per member, on
// every turn and every history load. They hardly change, so a warm server
// keeps them a few minutes.
const NAMES_TTL_MS = 5 * 60_000;
const namesCache = new Map<string, { at: number; names: Map<string, string> }>();

export async function memberNames(admin: SupabaseClient, groupId: string): Promise<Map<string, string>> {
  const cached = namesCache.get(groupId);
  if (cached && Date.now() - cached.at < NAMES_TTL_MS) return cached.names;
  const names = await loadMemberNames(admin, groupId);
  namesCache.set(groupId, { at: Date.now(), names });
  return names;
}

async function loadMemberNames(admin: SupabaseClient, groupId: string): Promise<Map<string, string>> {
  const { data: members } = await admin.from("group_members").select("user_id").eq("group_id", groupId);
  const names = new Map<string, string>();
  await Promise.all(
    (members ?? []).map(async (m: { user_id: string }) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      const meta = data.user?.user_metadata as { full_name?: string; name?: string } | undefined;
      const name = meta?.full_name ?? meta?.name ?? data.user?.email?.split("@")[0] ?? "Someone";
      names.set(m.user_id, name.split(" ")[0]);
    })
  );
  return names;
}

