import { NextResponse } from "next/server";
import { PLUS_ASSISTANT_ALLOWANCE_CENTS, summarizeUsage, usageMonth, type AssistantUsage, type UsageRecord } from "@homeup/core";
import { assistantRequest, loadSettings, memberNames } from "@/lib/assistant/service";

// HOUP-444: what the household spent on the assistant in a month, by person,
// feature and model, against its budget, each person's allowance and (on
// hosted Plus) the allowance on Rooftap's key. Everyone in the home can see it.
const MONTH = /^\d{4}-\d{2}(-01)?$/;

export async function GET(request: Request) {
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  const asked = new URL(request.url).searchParams.get("month");
  const month = asked && MONTH.test(asked) ? `${asked.slice(0, 7)}-01` : usageMonth();

  const [settings, names, { data: rows }, { data: limits }] = await Promise.all([
    loadSettings(ctx.admin, ctx.groupId),
    memberNames(ctx.admin, ctx.groupId),
    ctx.admin
      .from("assistant_usage")
      .select("user_id, feature, model, key_source, turns, input_tokens, output_tokens, cost_micros")
      .eq("group_id", ctx.groupId)
      .eq("month", month),
    ctx.admin.from("assistant_member_limits").select("user_id, monthly_budget_cents, read_only").eq("group_id", ctx.groupId),
  ]);
  const records = (rows ?? []) as UsageRecord[];
  const nameMap = Object.fromEntries(names);
  const limitBy = new Map(
    ((limits ?? []) as { user_id: string; monthly_budget_cents: number | null; read_only: boolean }[]).map((l) => [l.user_id, l])
  );

  const body: AssistantUsage = {
    month,
    summary: summarizeUsage(records, nameMap),
    budgetCents: settings.monthlyBudgetCents,
    warnAtPercent: settings.warnAtPercent,
    allowanceCents: ctx.access === "allowance" ? PLUS_ASSISTANT_ALLOWANCE_CENTS : null,
    serverMicros: records.filter((r) => r.key_source === "server").reduce((t, r) => t + Number(r.cost_micros || 0), 0),
    members: [...names].map(([userId, name]) => ({
      userId,
      name,
      budgetCents: limitBy.get(userId)?.monthly_budget_cents ?? null,
      readOnly: !!limitBy.get(userId)?.read_only,
      spentMicros: records.filter((r) => r.user_id === userId).reduce((t, r) => t + Number(r.cost_micros || 0), 0),
    })),
    isOwner: ctx.isOwner,
  };
  return NextResponse.json(body);
}
