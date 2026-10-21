import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FALLBACK_MODEL_PRICE,
  MODEL_PRICES,
  PLUS_ASSISTANT_ALLOWANCE_CENTS,
  assistantAccess,
  buildAssistantSystemPrompt,
  checkBudget,
  costMicros,
  describeProposal,
  entitlementTier,
  getModule,
  isConversationOpen,
  microsToCents,
  parseAssistantSettings,
  parseModelPrices,
  quickAskClosesAt,
  strictestBudget,
  trustFor,
  usageMonth,
  type AssistantAccess,
  type AssistantConversation,
  type AssistantErrorCode,
  type AssistantMessage,
  type AssistantSettings,
  type BudgetCheck,
  type ConversationKind,
  type GroupEntitlements,
  type MessageChannel,
  type ModuleId,
  type ProposalItem,
  type ProposalState,
} from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { getEnabledModules } from "@/lib/server-modules";
import { executeProposals, runAssistantTurn, type Proposal } from "./engine";
import { llmClient, type ChatMessage, type LlmClient } from "./llm";
import { resolveServerBrain, type AssistantBrain } from "./provider";
import { assistantTools } from "./tools";

// HOUP-443: the assistant's server side, shared by every /api/assistant
// route (and, later, Telegram and routines). Loads the household's context,
// enforces module, plan and budget, runs a turn through engine.ts and stores
// the conversation. All reads and writes use the service role with explicit
// group and owner filters, the same way the MCP tool handlers do.

export interface AssistantContext {
  admin: SupabaseClient;
  userId: string;
  groupId: string;
  isOwner: boolean;
  enabled: Set<ModuleId>;
  access: AssistantAccess;
}

export function assistantErrorResponse(status: number, error: string, code?: AssistantErrorCode) {
  return NextResponse.json(code ? { error, code } : { error }, { status });
}

/** Hosted Rooftap sets ROOFTAP_BILLING=on; self-hosted servers leave it off, so everyone there has the assistant. */
export function billingMode(): "on" | "off" {
  return process.env.ROOFTAP_BILLING?.trim().toLowerCase() === "on" ? "on" : "off";
}

/**
 * The front half of every /api/assistant route: a signed-in member, the
 * assistant module on for their household, and (unless `allowNoAccess`) a
 * plan that includes it.
 */
export async function assistantRequest(opts: { allowNoAccess?: boolean } = {}): Promise<{ error: NextResponse } | AssistantContext> {
  const user = await getSessionUser();
  if (!user) return { error: assistantErrorResponse(401, "Unauthorized") };
  const admin = createAdminClient();
  const { data: membership } = await admin.from("group_members").select("group_id, role").eq("user_id", user.id).limit(1).maybeSingle();
  if (!membership) return { error: assistantErrorResponse(404, "Not found") };
  const enabled = await getEnabledModules(admin, membership.group_id);
  if (!enabled.has("assistant")) return { error: assistantErrorResponse(404, "Not found") };

  const { data: ent } = await admin.from("group_entitlements").select("*").eq("group_id", membership.group_id).maybeSingle();
  const access = assistantAccess(entitlementTier(ent as GroupEntitlements | null), billingMode());
  if (access === "none" && !opts.allowNoAccess) {
    return { error: assistantErrorResponse(402, "The assistant comes with Plus.", "assistant_requires_plus") };
  }
  return { admin, userId: user.id, groupId: membership.group_id, isOwner: membership.role === "owner", enabled, access };
}

// ── Rows to DTOs ──────────────────────────────────────────────────────────

interface ConversationRow {
  id: string;
  group_id: string;
  owner_id: string | null;
  kind: ConversationKind;
  title: string | null;
  pinned: boolean;
  summary: string | null;
  last_active_at: string;
  closes_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  group_id: string;
  user_id: string | null;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls: unknown;
  proposal: { items?: (Proposal & { summary?: string })[] } | null;
  proposal_state: ProposalState | null;
  channel: MessageChannel;
  cost_micros: number | null;
  created_at: string;
}

export function toConversation(row: ConversationRow, pending = 0): AssistantConversation {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    pinned: row.pinned,
    last_active_at: row.last_active_at,
    closes_at: row.closes_at,
    pending,
  };
}

function proposalItems(row: MessageRow): ProposalItem[] {
  return (row.proposal?.items ?? []).map((p) => ({
    tool: p.tool,
    module: p.module as ModuleId,
    args: p.args,
    summary: p.summary ?? describeProposal(p.tool, p.module as ModuleId, p.args),
  }));
}

/** A stored row as the apps see it, or null for rows they don't show (tool output, tool-call steps). */
export function toMessage(row: MessageRow, names: Map<string, string>): AssistantMessage | null {
  if (row.role === "tool") return null;
  if (row.role === "assistant" && row.tool_calls && !row.content) return null;
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    author: row.role === "user" && row.user_id ? names.get(row.user_id) ?? null : null,
    channel: row.channel,
    created_at: row.created_at,
    proposal: row.proposal && row.proposal_state ? { items: proposalItems(row), state: row.proposal_state } : null,
    cost_micros: row.cost_micros,
  };
}

/** Rows back into the model's chat format, starting at a user message so no tool result is orphaned. */
export function toHistory(rows: MessageRow[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const row of rows) {
    if (row.role === "user") out.push({ role: "user", content: row.content });
    else if (row.role === "assistant") {
      const calls = Array.isArray(row.tool_calls) ? (row.tool_calls as { id: string; name: string; args: Record<string, unknown> }[]) : undefined;
      out.push({ role: "assistant", content: row.content, ...(calls?.length ? { toolCalls: calls } : {}) });
    } else {
      const meta = (row.tool_calls ?? {}) as { toolCallId?: string; name?: string };
      if (meta.toolCallId && meta.name) out.push({ role: "tool", toolCallId: meta.toolCallId, name: meta.name, content: row.content });
    }
  }
  const firstUser = out.findIndex((m) => m.role === "user");
  return firstUser < 0 ? [] : out.slice(firstUser);
}

// ── Household context ────────────────────────────────────────────────────

export async function memberNames(admin: SupabaseClient, groupId: string): Promise<Map<string, string>> {
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

export async function loadSettings(admin: SupabaseClient, groupId: string): Promise<AssistantSettings> {
  const { data } = await admin.from("assistant_settings").select("*").eq("group_id", groupId).maybeSingle();
  return parseAssistantSettings(data);
}

async function loadMemberLimits(admin: SupabaseClient, groupId: string, userId: string) {
  const { data } = await admin
    .from("assistant_member_limits")
    .select("monthly_budget_cents, read_only")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  return { budgetCents: (data?.monthly_budget_cents as number | null) ?? null, readOnly: !!data?.read_only };
}

interface UsageRow {
  user_id: string | null;
  key_source: "household" | "server";
  cost_micros: number;
}

export async function monthUsage(admin: SupabaseClient, groupId: string, month = usageMonth()) {
  const { data } = await admin.from("assistant_usage").select("user_id, key_source, cost_micros").eq("group_id", groupId).eq("month", month);
  return (data ?? []) as UsageRow[];
}

function sumCents(rows: UsageRow[], keep: (r: UsageRow) => boolean = () => true): number {
  return microsToCents(rows.filter(keep).reduce((total, r) => total + Number(r.cost_micros ?? 0), 0));
}

/** Household budget, the person's allowance, and the Plus allowance on Rooftap's key, strictest first. */
export function budgetFor(
  usage: UsageRow[],
  userId: string,
  settings: AssistantSettings,
  memberBudgetCents: number | null,
  access: AssistantAccess,
  keySource: AssistantBrain["keySource"]
): BudgetCheck {
  const checks = [
    checkBudget(sumCents(usage), settings.monthlyBudgetCents, settings.atLimit, settings.warnAtPercent),
    checkBudget(sumCents(usage, (r) => r.user_id === userId), memberBudgetCents, settings.atLimit, settings.warnAtPercent),
  ];
  if (access === "allowance" && keySource === "server") {
    checks.push(checkBudget(sumCents(usage, (r) => r.key_source === "server"), PLUS_ASSISTANT_ALLOWANCE_CENTS, "stop", 80));
  }
  return strictestBudget(...checks);
}

function formatNow(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    return now.toISOString();
  }
}

async function userTimeZone(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from("user_settings").select("timezone").eq("user_id", userId).maybeSingle();
  return (data?.timezone as string | undefined) || "UTC";
}

// ── Conversations ─────────────────────────────────────────────────────────

/** A conversation this person may see, or null. */
export async function findConversation(ctx: AssistantContext, id: string): Promise<ConversationRow | null> {
  const { data } = await ctx.admin
    .from("assistant_conversations")
    .select("*")
    .eq("id", id)
    .eq("group_id", ctx.groupId)
    .eq("deleted", false)
    .maybeSingle();
  const row = data as ConversationRow | null;
  if (!row || (row.kind !== "household" && row.owner_id !== ctx.userId)) return null;
  return row;
}

async function householdThread(ctx: AssistantContext): Promise<ConversationRow> {
  const { data: existing } = await ctx.admin
    .from("assistant_conversations")
    .select("*")
    .eq("group_id", ctx.groupId)
    .eq("kind", "household")
    .eq("deleted", false)
    .maybeSingle();
  if (existing) return existing as ConversationRow;
  const { data, error } = await ctx.admin
    .from("assistant_conversations")
    .insert({ group_id: ctx.groupId, owner_id: null, kind: "household", title: "Household", pinned: true })
    .select("*")
    .single();
  if (error || !data) {
    // Another member created it a moment ago (the partial unique index).
    const { data: again } = await ctx.admin
      .from("assistant_conversations")
      .select("*")
      .eq("group_id", ctx.groupId)
      .eq("kind", "household")
      .eq("deleted", false)
      .single();
    return again as ConversationRow;
  }
  return data as ConversationRow;
}

function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0];
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}...` : line;
}

async function startConversation(ctx: AssistantContext, kind: Exclude<ConversationKind, "household">, text: string, idleMinutes: number) {
  const now = new Date();
  const { data, error } = await ctx.admin
    .from("assistant_conversations")
    .insert({
      group_id: ctx.groupId,
      owner_id: ctx.userId,
      kind,
      title: titleFrom(text),
      last_active_at: now.toISOString(),
      closes_at: kind === "quick" ? quickAskClosesAt(now, idleMinutes).toISOString() : null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not start a conversation");
  return data as ConversationRow;
}

export async function pendingCounts(ctx: AssistantContext, conversationIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (conversationIds.length === 0) return counts;
  const { data } = await ctx.admin
    .from("assistant_messages")
    .select("conversation_id")
    .eq("group_id", ctx.groupId)
    .eq("proposal_state", "pending")
    .in("conversation_id", conversationIds);
  for (const r of (data ?? []) as { conversation_id: string }[]) counts.set(r.conversation_id, (counts.get(r.conversation_id) ?? 0) + 1);
  return counts;
}

export async function listConversations(ctx: AssistantContext): Promise<AssistantConversation[]> {
  const { data } = await ctx.admin
    .from("assistant_conversations")
    .select("*")
    .eq("group_id", ctx.groupId)
    .eq("deleted", false)
    .or(`kind.eq.household,owner_id.eq.${ctx.userId}`)
    .order("last_active_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as ConversationRow[];
  const pending = await pendingCounts(ctx, rows.map((r) => r.id));
  return rows.map((r) => toConversation(r, pending.get(r.id) ?? 0));
}

export async function conversationMessages(ctx: AssistantContext, conversation: ConversationRow): Promise<AssistantMessage[]> {
  const { data } = await ctx.admin
    .from("assistant_messages")
    .select("*")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true })
    .limit(500);
  const names = await memberNames(ctx.admin, ctx.groupId);
  return ((data ?? []) as MessageRow[]).flatMap((r) => toMessage(r, names) ?? []);
}

// ── A turn ────────────────────────────────────────────────────────────────

export interface ChatInput {
  text: string;
  conversationId?: string | null;
  kind?: ConversationKind;
  channel?: MessageChannel;
}

export type ChatOutcome =
  | { ok: true; conversation: AssistantConversation; messages: AssistantMessage[]; budget: BudgetCheck["status"] }
  | { ok: false; status: number; error: string; code?: AssistantErrorCode };

function priceTable(): Record<string, { input: number; output: number }> {
  return { ...MODEL_PRICES, ...parseModelPrices(process.env.ASSISTANT_MODEL_PRICES) };
}

/** Spend for one turn in micro-dollars: listed price, else free for a local server, else the fallback price. */
export function turnCost(brain: Pick<AssistantBrain, "free">, model: string, input: number, output: number): number {
  const prices = priceTable();
  return costMicros(model, input, output, prices) ?? (brain.free ? 0 : costMicros(model, input, output, { [model]: FALLBACK_MODEL_PRICE })!);
}

export interface ChatDeps {
  brain?: AssistantBrain | null;
  llm?: LlmClient;
  now?: Date;
}

export async function runChat(ctx: AssistantContext, input: ChatInput, deps: ChatDeps = {}): Promise<ChatOutcome> {
  const text = input.text.trim();
  if (!text) return { ok: false, status: 400, error: "Say something first." };
  const brain = deps.brain === undefined ? await resolveServerBrain() : deps.brain;
  if (!brain) return { ok: false, status: 503, error: "No AI model is set up on this server yet.", code: "assistant_not_configured" };

  const settings = await loadSettings(ctx.admin, ctx.groupId);
  const limits = await loadMemberLimits(ctx.admin, ctx.groupId, ctx.userId);
  const budget = budgetFor(await monthUsage(ctx.admin, ctx.groupId), ctx.userId, settings, limits.budgetCents, ctx.access, brain.keySource);
  if (budget.action === "stop") {
    return { ok: false, status: 402, error: "This month's assistant budget is used up.", code: "assistant_budget_reached" };
  }

  const now = deps.now ?? new Date();
  let conversation: ConversationRow;
  if (input.conversationId) {
    const found = await findConversation(ctx, input.conversationId);
    if (!found) return { ok: false, status: 404, error: "Not found" };
    if (!isConversationOpen(found.kind, found.closes_at, now)) {
      return { ok: false, status: 409, error: "This quick ask has closed. Start a new one.", code: "assistant_conversation_closed" };
    }
    conversation = found;
  } else if (input.kind === "household") {
    conversation = await householdThread(ctx);
  } else {
    conversation = await startConversation(ctx, input.kind === "chat" ? "chat" : "quick", text, settings.quickAskIdleMinutes);
  }

  const { data: recent } = await ctx.admin
    .from("assistant_messages")
    .select("*")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(settings.contextMessages * 3);
  const history = toHistory(((recent ?? []) as MessageRow[]).reverse()).slice(-settings.contextMessages * 3);

  const [{ data: memoryRows }, names, timeZone] = await Promise.all([
    ctx.admin.from("assistant_memories").select("text").eq("group_id", ctx.groupId).eq("deleted", false).order("created_at").limit(60),
    memberNames(ctx.admin, ctx.groupId),
    userTimeZone(ctx.admin, ctx.userId),
  ]);

  const tools = assistantTools(
    { admin: ctx.admin, userId: ctx.userId, groupId: ctx.groupId, enabled: ctx.enabled },
    { settings, readOnly: limits.readOnly }
  );
  const reachable = [...new Set(tools.map((t) => t.module))];
  const system = buildAssistantSystemPrompt({
    now: formatNow(timeZone, now),
    timeZone,
    person: names.get(ctx.userId) ?? "a household member",
    members: [...names.values()],
    modules: reachable.map((m) => ({
      label: getModule(m)?.label ?? m,
      trust: limits.readOnly ? "read" : trustFor(settings.trust, m),
    })),
    memories: ((memoryRows ?? []) as { text: string }[]).map((m) => m.text),
    kind: conversation.kind,
    channel: input.channel ?? "app",
    summary: conversation.summary,
  });

  const useCheap = budget.action === "cheap" || conversation.kind === "quick";
  const model = useCheap ? settings.quickModel ?? brain.quickModel : settings.chatModel ?? brain.chatModel;
  const channel = input.channel ?? "app";

  const { data: userRow, error: userErr } = await ctx.admin
    .from("assistant_messages")
    .insert({ conversation_id: conversation.id, group_id: ctx.groupId, user_id: ctx.userId, role: "user", content: text, channel })
    .select("*")
    .single();
  if (userErr || !userRow) return { ok: false, status: 500, error: userErr?.message ?? "Could not save the message" };

  let turn;
  try {
    turn = await runAssistantTurn({ llm: deps.llm ?? llmClient(brain.connection), model, system, history, userText: text, tools });
  } catch (e) {
    console.error("[assistant] turn failed", e);
    return { ok: false, status: 502, error: "The AI model didn't answer. Try again in a moment." };
  }

  const cost = turnCost(brain, model, turn.inputTokens, turn.outputTokens);
  // Steps before the final answer are stored for the model's memory of the
  // turn; only the last one carries the proposals, tokens and cost.
  const steps = turn.messages.slice(0, -1).map((m) => ({
    conversation_id: conversation.id,
    group_id: ctx.groupId,
    user_id: ctx.userId,
    role: m.role,
    content: m.content,
    tool_calls: m.role === "assistant" ? m.toolCalls ?? null : m.role === "tool" ? { toolCallId: m.toolCallId, name: m.name } : null,
    channel,
  }));
  if (steps.length) await ctx.admin.from("assistant_messages").insert(steps);
  const items = turn.proposals.map((p) => ({ ...p, summary: describeProposal(p.tool, p.module as ModuleId, p.args) }));
  const { data: replyRow } = await ctx.admin
    .from("assistant_messages")
    .insert({
      conversation_id: conversation.id,
      group_id: ctx.groupId,
      user_id: ctx.userId,
      role: "assistant",
      content: turn.reply,
      proposal: items.length ? { items } : null,
      proposal_state: items.length ? "pending" : null,
      channel,
      model,
      input_tokens: turn.inputTokens,
      output_tokens: turn.outputTokens,
      cost_micros: cost,
    })
    .select("*")
    .single();

  if (turn.memories.length) {
    await ctx.admin
      .from("assistant_memories")
      .insert(turn.memories.map((m) => ({ group_id: ctx.groupId, text: m.slice(0, 500), source: "agent", created_by: ctx.userId })));
  }
  await ctx.admin.rpc("assistant_record_usage", {
    p_group_id: ctx.groupId,
    p_user_id: ctx.userId,
    p_month: usageMonth(now),
    p_feature: channel === "telegram" ? "telegram" : conversation.kind === "quick" ? "quick" : conversation.kind,
    p_model: model,
    p_key_source: brain.keySource,
    p_input_tokens: turn.inputTokens,
    p_output_tokens: turn.outputTokens,
    p_cost_micros: cost,
  });
  const touched = {
    last_active_at: now.toISOString(),
    ...(conversation.kind === "quick" ? { closes_at: quickAskClosesAt(now, settings.quickAskIdleMinutes).toISOString() } : {}),
  };
  await ctx.admin.from("assistant_conversations").update(touched).eq("id", conversation.id);

  const after = budgetFor(await monthUsage(ctx.admin, ctx.groupId), ctx.userId, settings, limits.budgetCents, ctx.access, brain.keySource);
  const pending = await pendingCounts(ctx, [conversation.id]);
  return {
    ok: true,
    conversation: toConversation({ ...conversation, ...touched }, pending.get(conversation.id) ?? 0),
    messages: [userRow as MessageRow, replyRow as MessageRow].flatMap((r) => (r ? toMessage(r, names) ?? [] : [])),
    budget: after.status,
  };
}

// ── Proposals ─────────────────────────────────────────────────────────────

export type DecisionOutcome =
  | { ok: true; message: AssistantMessage; outcome: AssistantMessage | null }
  | { ok: false; status: number; error: string };

export async function decideProposal(ctx: AssistantContext, messageId: string, decision: "confirm" | "decline"): Promise<DecisionOutcome> {
  const { data } = await ctx.admin.from("assistant_messages").select("*").eq("id", messageId).eq("group_id", ctx.groupId).maybeSingle();
  const row = data as MessageRow | null;
  if (!row || !(await findConversation(ctx, row.conversation_id))) return { ok: false, status: 404, error: "Not found" };
  if (row.proposal_state !== "pending") return { ok: false, status: 409, error: "Already decided." };

  // Claim it first, so a double tap can't apply the same change twice.
  const next: ProposalState = decision === "confirm" ? "confirmed" : "declined";
  const { data: claimed } = await ctx.admin
    .from("assistant_messages")
    .update({ proposal_state: next })
    .eq("id", messageId)
    .eq("proposal_state", "pending")
    .select("id");
  if (!claimed?.length) return { ok: false, status: 409, error: "Already decided." };

  const names = await memberNames(ctx.admin, ctx.groupId);
  const who = names.get(ctx.userId) ?? "Someone";
  let note: string;
  if (decision === "decline") {
    note = `${who} said not now, so nothing was changed.`;
  } else {
    const settings = await loadSettings(ctx.admin, ctx.groupId);
    const limits = await loadMemberLimits(ctx.admin, ctx.groupId, ctx.userId);
    const tools = assistantTools(
      { admin: ctx.admin, userId: ctx.userId, groupId: ctx.groupId, enabled: ctx.enabled },
      { settings, readOnly: limits.readOnly }
    );
    const items = proposalItems(row);
    const outcomes = await executeProposals(
      (row.proposal?.items ?? []).map((p) => ({ toolCallId: p.toolCallId, tool: p.tool, module: p.module, args: p.args })),
      tools
    );
    const done = items.filter((_, i) => outcomes[i]?.ok).map((i) => i.summary);
    const failed = items.filter((_, i) => !outcomes[i]?.ok).map((i) => i.summary);
    note = [
      done.length ? `Done: ${done.join("; ")}.` : null,
      failed.length ? `Couldn't do: ${failed.join("; ")}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  // A plain assistant line, so the next turn's model knows what happened.
  const { data: outcomeRow } = await ctx.admin
    .from("assistant_messages")
    .insert({ conversation_id: row.conversation_id, group_id: ctx.groupId, user_id: ctx.userId, role: "assistant", content: note, channel: row.channel })
    .select("*")
    .single();
  await ctx.admin.from("assistant_conversations").update({ last_active_at: new Date().toISOString() }).eq("id", row.conversation_id);

  const updated = toMessage({ ...row, proposal_state: next }, names)!;
  return { ok: true, message: updated, outcome: outcomeRow ? toMessage(outcomeRow as MessageRow, names) : null };
}

