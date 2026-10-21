import { NextResponse } from "next/server";
import { isTrustLevel, isModuleId, parseAssistantSettings, type AssistantSettings } from "@homeup/core";
import { assistantErrorResponse, assistantRequest, loadSettings } from "@/lib/assistant/service";

// HOUP-443: the household's assistant settings. Everyone reads them; owners change them.
export async function GET() {
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  return NextResponse.json({ settings: await loadSettings(ctx.admin, ctx.groupId), isOwner: ctx.isOwner });
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
  if (body.chatModel !== undefined) row.chat_model = typeof body.chatModel === "string" ? body.chatModel.trim().slice(0, 120) || null : null;
  if (body.quickModel !== undefined) row.quick_model = typeof body.quickModel === "string" ? body.quickModel.trim().slice(0, 120) || null : null;
  if (typeof body.contextMessages === "number") row.context_messages = body.contextMessages;
  if (typeof body.quickAskIdleMinutes === "number") row.quick_ask_idle_minutes = body.quickAskIdleMinutes;
  if (body.monthlyBudgetCents !== undefined) {
    row.monthly_budget_cents =
      typeof body.monthlyBudgetCents === "number" && body.monthlyBudgetCents >= 0 ? Math.round(body.monthlyBudgetCents) : null;
  }
  if (typeof body.atLimit === "string" && AT_LIMIT.has(body.atLimit)) row.at_limit = body.atLimit;
  if (typeof body.warnAtPercent === "number") row.warn_at_percent = Math.min(100, Math.max(1, Math.round(body.warnAtPercent)));
  if (typeof body.showCostPerReply === "boolean") row.show_cost_per_reply = body.showCostPerReply;

  const { data, error } = await ctx.admin.from("assistant_settings").upsert(row, { onConflict: "group_id" }).select("*").single();
  if (error) return assistantErrorResponse(500, error.message);
  return NextResponse.json({ settings: parseAssistantSettings(data) });
}
