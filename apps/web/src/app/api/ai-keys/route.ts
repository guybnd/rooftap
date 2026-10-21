import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aiAccess,
  aiKeyLast4,
  cleanAiKey,
  isAiKeyProvider,
  PLUS_AI_READS_PER_MONTH,
  type HouseholdAiKeysStatus,
} from "@homeup/core";
import { getSessionUser } from "@/lib/supabase/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingMode, householdTier } from "@/lib/billing";
import { monthReads } from "@/lib/ai/access";
import { canStoreHouseholdKeys, encryptHouseholdKey, householdKeyRows } from "@/lib/ai/household-keys";

// HOUP-436: a household's own AI keys (Settings > AI keys). Every member sees
// which providers have a key (last four characters only) and how many of
// this month's AI reads went on the server's key; owners add and remove keys.
// The key itself never leaves the server once saved.

interface HouseholdContext {
  admin: SupabaseClient;
  userId: string;
  groupId: string;
  isOwner: boolean;
}

async function household(): Promise<{ error: NextResponse } | HouseholdContext> {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const admin = createAdminClient();
  const { data } = await admin.from("group_members").select("group_id, role").eq("user_id", user.id).limit(1).maybeSingle();
  if (!data) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { admin, userId: user.id, groupId: data.group_id as string, isOwner: data.role === "owner" };
}

export async function GET() {
  const ctx = await household();
  if ("error" in ctx) return ctx.error;
  const [rows, tier, used] = await Promise.all([
    householdKeyRows(ctx.admin, ctx.groupId),
    householdTier(ctx.admin, ctx.groupId),
    monthReads(ctx.admin, ctx.groupId),
  ]);
  const access = aiAccess(tier, billingMode());
  const status: HouseholdAiKeysStatus = {
    keys: rows.filter((r) => isAiKeyProvider(r.provider)).map((r) => ({ provider: r.provider as HouseholdAiKeysStatus["keys"][number]["provider"], last4: r.last4, createdAt: r.created_at })),
    access,
    used,
    allowance: access === "allowance" ? PLUS_AI_READS_PER_MONTH : null,
    isOwner: ctx.isOwner,
    canStore: canStoreHouseholdKeys(),
  };
  return NextResponse.json(status);
}

export async function PUT(request: Request) {
  const ctx = await household();
  if ("error" in ctx) return ctx.error;
  if (!ctx.isOwner) return NextResponse.json({ error: "Only a household owner can change AI keys." }, { status: 403 });
  if (!canStoreHouseholdKeys()) {
    return NextResponse.json({ error: "This server isn't set up to store household keys yet (HOUSEHOLD_KEYS_SECRET)." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  if (!isAiKeyProvider(body?.provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  const key = cleanAiKey(body?.key);
  if (!key) return NextResponse.json({ error: "That doesn't look like an API key." }, { status: 400 });

  const { error } = await ctx.admin.from("household_ai_keys").upsert({
    group_id: ctx.groupId,
    provider: body.provider,
    encrypted_key: encryptHouseholdKey(key),
    last4: aiKeyLast4(key),
    created_by: ctx.userId,
    created_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: `The key couldn't be saved: ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, last4: aiKeyLast4(key) });
}

export async function DELETE(request: Request) {
  const ctx = await household();
  if ("error" in ctx) return ctx.error;
  if (!ctx.isOwner) return NextResponse.json({ error: "Only a household owner can change AI keys." }, { status: 403 });
  const provider = new URL(request.url).searchParams.get("provider");
  if (!isAiKeyProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  const { error } = await ctx.admin.from("household_ai_keys").delete().eq("group_id", ctx.groupId).eq("provider", provider);
  if (error) return NextResponse.json({ error: `The key couldn't be removed: ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true });
}
