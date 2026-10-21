import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiAccess, aiBlockedMessage, aiUsageMonth, decideAiKey, type AiErrorCode, type AiKeyProvider } from "@homeup/core";
import { loadAiServerSettings, resolveParsingProvider, resolveReadsModel, type ParsingType } from "@/lib/admin-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingMode, householdTier } from "@/lib/billing";
import { householdKeys } from "./household-keys";
import { serverProviderKey, type AiCallKey } from "./providers";

// HOUP-436: the gate in front of every single-shot AI read (receipts,
// recipes, listings, events). The rule itself is core's decideAiKey; this
// gathers its inputs, and counts reads made on the server's key.

export class AiBlockedError extends Error {
  constructor(readonly code: AiErrorCode) {
    super(aiBlockedMessage(code));
  }
}

export interface ResolvedAiKey extends AiCallKey {
  source: "household" | "server";
  groupId: string | null;
}

export async function memberGroupId(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.from("group_members").select("group_id").eq("user_id", userId).limit(1).maybeSingle();
  return (data?.group_id as string | undefined) ?? null;
}

/** Server-key reads this household has made this month. An older server without the table counts none. */
export async function monthReads(admin: SupabaseClient, groupId: string, month = aiUsageMonth()): Promise<number> {
  const { data, error } = await admin.from("ai_usage").select("reads").eq("group_id", groupId).eq("month", month).maybeSingle();
  if (error) return 0;
  return Number(data?.reads ?? 0);
}

/** Whose key a person's AI read of this kind uses. Throws AiBlockedError when there is none they may use. */
export async function resolveAiKey(userId: string, type: ParsingType, admin: SupabaseClient = createAdminClient()): Promise<ResolvedAiKey> {
  const groupId = await memberGroupId(admin, userId);
  const settings = await loadAiServerSettings();
  const preferred = (await resolveParsingProvider(type, settings)) as AiKeyProvider;
  const own = groupId ? await householdKeys(admin, groupId) : new Map<AiKeyProvider, string>();
  const access = aiAccess(groupId ? await householdTier(admin, groupId) : "free", billingMode());
  const serverKey = await serverProviderKey(preferred);
  const usedThisMonth = access === "allowance" && groupId ? await monthReads(admin, groupId) : 0;

  const decision = decideAiKey({ preferred, householdKeys: new Set(own.keys()), serverKey: !!serverKey, access, usedThisMonth });
  if ("blocked" in decision) throw new AiBlockedError(decision.blocked);
  const model = await resolveReadsModel(decision.provider, settings);
  if (decision.source === "household") {
    return { provider: decision.provider, apiKey: own.get(decision.provider)!, model, source: "household", groupId };
  }
  return { provider: decision.provider, apiKey: serverKey!, model, source: "server", groupId };
}

/** Counts one finished read against the household's month when it used the server's key. Never fails the read. */
export async function recordAiRead(key: ResolvedAiKey, admin: SupabaseClient = createAdminClient()): Promise<void> {
  if (key.source !== "server" || !key.groupId) return;
  const { error } = await admin.rpc("ai_record_read", { p_group_id: key.groupId, p_month: aiUsageMonth() });
  if (error) console.error("[ai] could not count a read", error.message);
}

/** The 402 both apps recognise by its code; the message already says what to do. */
export function aiBlockedResponse(err: AiBlockedError): NextResponse {
  return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === "ai_not_configured" ? 503 : 402 });
}
