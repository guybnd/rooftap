import { NextResponse } from "next/server";
import { helperCanShare, isTrustLevel, isModuleId, moduleHelper, parseAssistantSettings, parseHelperSettings, type AssistantSettings } from "@homeup/core";
import { resolveServerKeys } from "@/lib/admin-config";
import { householdKeys } from "@/lib/ai/household-keys";
import { SERVER_BRAIN_KEYS, assistantModelChoices, isAllowedModelPick } from "@/lib/assistant/provider";
import { assistantErrorResponse, assistantRequest, loadSettings } from "@/lib/assistant/service";
import type { SupabaseClient } from "@supabase/supabase-js";

async function modelChoices(admin: SupabaseClient, groupId: string) {
  const [keys, lookup] = await Promise.all([householdKeys(admin, groupId), resolveServerKeys(SERVER_BRAIN_KEYS)]);
  return assistantModelChoices(lookup, keys);
}

// HOUP-443: the household's assistant settings. Everyone reads them; owners change them.
export async function GET() {
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  const [settings, models] = await Promise.all([loadSettings(ctx.admin, ctx.groupId), modelChoices(ctx.admin, ctx.groupId)]);
  return NextResponse.json({ settings, isOwner: ctx.isOwner, models });
}

const AT_LIMIT = new Set(["warn", "cheap", "stop"]);

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<AssistantSettings>;
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  if (!ctx.isOwner) return assistantErrorResponse(403, "Only household owners can change the assistant.");

  const current = await loadSettings(ctx.admin, ctx.groupId);
  const row: Record<string, unknown> = { group_id: ctx.groupId, updated_by: ctx.userId };
  if (body.trust && typeof body.trust === "object") {
    const trust: Record<string, string> = { ...current.trust };
    for (const [module, level] of Object.entries(body.trust)) if (isModuleId(module) && isTrustLevel(level)) trust[module] = level;
    row.trust = trust;
  }
  // A model pick is a ref from the household's choices (core ai-providers.ts), or null for the server's default.
  const pick = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 160) || null : null);
  if (body.chatModel !== undefined || body.quickModel !== undefined) {
    const choices = await modelChoices(ctx.admin, ctx.groupId);
    if (body.chatModel !== undefined) {
      if (!isAllowedModelPick(pick(body.chatModel), choices.chat)) return assistantErrorResponse(400, "That model isn't available on this server.");
      row.chat_model = pick(body.chatModel);
    }
    if (body.quickModel !== undefined) {
      if (!isAllowedModelPick(pick(body.quickModel), choices.quick)) return assistantErrorResponse(400, "That model isn't available on this server.");
      row.quick_model = pick(body.quickModel);
    }
  }
  if (typeof body.contextMessages === "number") row.context_messages = body.contextMessages;
  if (typeof body.quickAskIdleMinutes === "number") row.quick_ask_idle_minutes = body.quickAskIdleMinutes;
  if (body.monthlyBudgetCents !== undefined) {
    row.monthly_budget_cents =
      typeof body.monthlyBudgetCents === "number" && body.monthlyBudgetCents >= 0 ? Math.round(body.monthlyBudgetCents) : null;
  }
  if (typeof body.atLimit === "string" && AT_LIMIT.has(body.atLimit)) row.at_limit = body.atLimit;
  if (typeof body.warnAtPercent === "number") row.warn_at_percent = Math.min(100, Math.max(1, Math.round(body.warnAtPercent)));
  if (typeof body.showCostPerReply === "boolean") row.show_cost_per_reply = body.showCostPerReply;
  // Module helpers (core module-helpers.ts): each one given is merged over what is stored.
  // A helper that can never be shared (Gifts) stays private whatever is sent.
  if (body.helpers && typeof body.helpers === "object") {
    const helpers: Record<string, unknown> = { ...current.helpers };
    for (const [id, patch] of Object.entries(body.helpers)) {
      const helper = moduleHelper(id);
      if (!helper || !patch || typeof patch !== "object") continue;
      const next = parseHelperSettings({ ...current.helpers[helper.id], ...patch });
      helpers[helper.id] = { ...next, shared: next.shared && helperCanShare(helper) };
    }
    row.helpers = helpers;
  }

  const { data, error } = await ctx.admin.from("assistant_settings").upsert(row, { onConflict: "group_id" }).select("*").single();
  if (error) return assistantErrorResponse(500, error.message);
  return NextResponse.json({ settings: parseAssistantSettings(data) });
}
