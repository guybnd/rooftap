import type { SupabaseClient } from "@supabase/supabase-js";
import { entitlementTier, type EntitlementTier, type GroupEntitlements } from "@homeup/core";

/** Hosted Rooftap sets ROOFTAP_BILLING=on; self-hosted servers leave it off, so every household there acts as Plus with no caps. */
export function billingMode(): "on" | "off" {
  return process.env.ROOFTAP_BILLING?.trim().toLowerCase() === "on" ? "on" : "off";
}

/** A household's plan tier from `group_entitlements` (no row = Free). */
export async function householdTier(admin: SupabaseClient, groupId: string): Promise<EntitlementTier> {
  const { data } = await admin.from("group_entitlements").select("*").eq("group_id", groupId).maybeSingle();
  return entitlementTier(data as GroupEntitlements | null);
}
