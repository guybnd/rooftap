import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FALLBACK_MODEL_PRICE,
  HOME_ASSISTANT_LABEL,
  HOME_ASSISTANT_SCOPE,
  MODEL_PRICES,
  PLUS_ASSISTANT_ALLOWANCE_CENTS,
  SUMMARY_SYSTEM_PROMPT,
  assistantAccess,
  buildAssistantSystemPrompt,
  checkBudget,
  costMicros,
  applyProposalPicks,
  describeProposal,
  entitlementTier,
  getModule,
  MCP_TOOLS,
  isConversationOpen,
  wantsAssistantReply,
  microsToCents,
  parseAssistantSettings,
  parseModelPrices,
  quickAskClosesAt,
  strictestBudget,
  summaryRequest,
  trustFor,
  usageMonth,
  type AssistantAccess,
  type AssistantConversation,
  type AssistantErrorCode,
  type AssistantMessage,
  type AssistantScope,
  type AssistantSettings,
  type BudgetCheck,
  type ConversationKind,
  type GroupEntitlements,
  type MessageChannel,
  type ModuleId,
  type ProposalItem,
  type ProposalState,
  cookTimers,
  cookingPromptText,
  recipeSteps,
  type CookAskContext,
  type CookSession,
  type Recipe,
  type RecipeIngredient,
  type ProposalPick,
  type EntitlementTier,
  assistantPhotoKeepDays,
} from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { getEnabledModules } from "@/lib/server-modules";
import { billingMode } from "@/lib/billing";
import { TurnTimeoutError, executeProposals, failureReason, runAssistantTurn, type Proposal, type TurnStreamEvent } from "./engine";
import { isProviderBusy, llmClient, withFallbackModel, type ChatImage, type ChatMessage, type LlmClient } from "./llm";
import { SERVER_BRAIN_KEYS, brainTakesPhotos, resolveAssistantBrain, resolveBackupBrain, type AssistantBrain } from "./provider";
import { loadKeptPhotos, photoUrls, preparePhotos, sweepOldPhotos } from "./photos";
import { photoTool } from "./photo-tool";
import { resolveServerKeys } from "@/lib/admin-config";
import { householdKeys } from "@/lib/ai/household-keys";
import { assistantTools } from "./tools";
import { homeAssistantTools } from "./home-assistant";
import { feedbackTool } from "./feedback-tool";
import { isUnread, markConversationRead, readStates } from "./reads";
import { memberNames } from "@/lib/member-names";

export { memberNames };

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
  /** The household's plan, for how long chat photos are kept. Missing in older callers: free. */
  tier?: EntitlementTier;
}

export function assistantErrorResponse(status: number, error: string, code?: AssistantErrorCode) {
  return NextResponse.json(code ? { error, code } : { error }, { status });
}

export { billingMode };

/**
 * The front half of every /api/assistant route: a signed-in member, the
 * assistant module on for their household, and (unless `allowNoAccess`) a
 * plan that includes it.
 */
export async function assistantRequest(opts: { allowNoAccess?: boolean } = {}): Promise<{ error: NextResponse } | AssistantContext> {
  const user = await getSessionUser();
  if (!user) return { error: assistantErrorResponse(401, "Unauthorized") };
  const ctx = await assistantContextFor(createAdminClient(), user.id);
  if ("error" in ctx) return { error: assistantErrorResponse(ctx.status, ctx.error, ctx.code) };
  if (ctx.access === "none" && !opts.allowNoAccess) {
    return { error: assistantErrorResponse(402, "The assistant comes with Plus.", "assistant_requires_plus") };
  }
  return ctx;
}

/**
 * A member's assistant context without a web session: the routes above and
 * channels that identify the person another way (Telegram's link).
 */
export async function assistantContextFor(
  admin: SupabaseClient,
  userId: string
): Promise<AssistantContext | { error: string; status: number; code?: AssistantErrorCode }> {
  const { data: membership } = await admin.from("group_members").select("group_id, role").eq("user_id", userId).limit(1).maybeSingle();
  if (!membership) return { error: "Not found", status: 404 };
  // Independent reads go together: each is a round trip to the database.
  const [enabled, { data: ent }] = await Promise.all([
    getEnabledModules(admin, membership.group_id),
    admin.from("group_entitlements").select("*").eq("group_id", membership.group_id).maybeSingle(),
  ]);
  if (!enabled.has("assistant")) return { error: "Not found", status: 404 };
  const tier = entitlementTier(ent as GroupEntitlements | null);
  const access = assistantAccess(tier, billingMode());
  return { admin, userId, groupId: membership.group_id, isOwner: membership.role === "owner", enabled, access, tier };
}

/**
 * Everything the assistant may call this turn: the household tools for its
 * switched-on modules, Home Assistant's when the household connected it, and
 * sending feedback to the Rooftap team.
 */
async function turnTools(
  ctx: AssistantContext,
  settings: AssistantSettings,
  readOnly: boolean,
  { deviceId, shared = false }: { deviceId?: string | null; shared?: boolean } = {}
) {
  const household = assistantTools(
    { admin: ctx.admin, userId: ctx.userId, groupId: ctx.groupId, enabled: ctx.enabled, deviceId, shared },
    { settings, readOnly }
  );
  const homeAssistant = await homeAssistantTools(ctx.admin, ctx.groupId, { readOnly });
  const feedback = feedbackTool(ctx.admin, ctx.userId, ctx.groupId);
  // Filing a chat photo in Documents, so it outlives the chat's keep time.
  const filing = ctx.enabled.has("documents") && !readOnly ? photoTool(ctx.admin, ctx.userId, ctx.groupId, trustFor(settings.trust, "documents")) : null;
  return { tools: [...household, ...(homeAssistant?.tools ?? []), feedback, ...(filing ? [filing] : [])], homeAssistant };
}

/** The cook mode section of the prompt: the recipe, its steps and the person's timers on it. */
async function cookingContext(ctx: AssistantContext, cook: CookAskContext, now: number): Promise<string | null> {
  const [{ data: recipeRows }, { data: ingredientRows }, { data: cookRows }] = await Promise.all([
    ctx.admin.from("recipes").select("*").eq("id", cook.recipeId).eq("group_id", ctx.groupId).eq("deleted", false),
    ctx.admin.from("recipe_ingredients").select("*").eq("recipe_id", cook.recipeId).eq("group_id", ctx.groupId).eq("deleted", false),
    ctx.admin.from("cook_sessions").select("*").eq("recipe_id", cook.recipeId).eq("group_id", ctx.groupId).eq("user_id", ctx.userId).eq("deleted", false),
  ]);
  const recipe = ((recipeRows ?? []) as Recipe[])[0];
  if (!recipe) return null;
  const session = ((cookRows ?? []) as CookSession[])[0];
  return cookingPromptText({
    title: recipe.title,
    servings: recipe.servings,
    ingredients: ((ingredientRows ?? []) as RecipeIngredient[]).sort((a, b) => a.position - b.position),
    steps: recipeSteps(recipe),
    step: cook.step,
    timers: session ? cookTimers(session) : [],
    now,
  });
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
  /** Newest message folded into `summary` (20261021110000); undefined before that migration. */
  summary_through?: string | null;
  last_active_at: string;
  closes_at: string | null;
  /** When its owner archived it (20261022093000); null or undefined when not. */
  archived_at?: string | null;
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
  /** Storage paths of photos sent with it (20261023210000); undefined before that migration. */
  photos?: string[] | null;
}

export function toConversation(row: ConversationRow, pending = 0, unread = false): AssistantConversation {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    pinned: row.pinned,
    last_active_at: row.last_active_at,
    closes_at: row.closes_at,
    pending,
    unread,
    archived: !!row.archived_at,
  };
}

function proposalItems(row: MessageRow): ProposalItem[] {
  return (row.proposal?.items ?? []).map((p) => ({
    tool: p.tool,
    module: p.module as ModuleId,
    args: p.args,
    summary: p.summary ?? describeProposal(p.tool, p.module as AssistantScope, p.args),
  }));
}

/** A stored row as the apps see it, or null for rows they don't show (tool output, tool-call steps). */
/**
 * A stored message for the app; `viewerId` marks which ones the person
 * looking wrote, and `urls` (photoUrls) holds links to its photos.
 */
export function toMessage(row: MessageRow, names: Map<string, string>, viewerId?: string, urls?: Map<string, string>): AssistantMessage | null {
  if (row.role === "tool") return null;
  if (row.role === "assistant" && row.tool_calls && !row.content) return null;
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    author: row.role === "user" && row.user_id ? names.get(row.user_id) ?? null : null,
    ...(viewerId ? { mine: row.role === "user" && row.user_id === viewerId } : {}),
    channel: row.channel,
    created_at: row.created_at,
    proposal: row.proposal && row.proposal_state ? { items: proposalItems(row), state: row.proposal_state } : null,
    cost_micros: row.cost_micros,
    ...(row.photos?.length ? { photos: row.photos.map((p) => ({ url: urls?.get(p) ?? null })) } : {}),
  };
}

/** Links to every photo on these rows, for toMessage. */
export function rowPhotoUrls(admin: SupabaseClient, rows: readonly MessageRow[]): Promise<Map<string, string>> {
  return photoUrls(admin, rows.flatMap((r) => r.photos ?? []));
}

/**
 * The note the model reads for a message's photos, naming each by its
 * storage path so file_photo can find it (also after the photo itself has
 * left the context).
 */
export function photoNote(paths: readonly string[]): string {
  return paths.length === 1 ? `[sent a photo: ${paths[0]}]` : `[sent ${paths.length} photos: ${paths.join(", ")}]`;
}

/** A person's message as the model reads it: its text, with a note when photos came with it. */
export function withPhotoNote(text: string, paths: readonly string[] | null | undefined): string {
  if (!paths?.length) return text;
  return text ? `${text}\n${photoNote(paths)}` : photoNote(paths);
}

function userText(row: Pick<MessageRow, "content" | "photos">): string {
  return withPhotoNote(row.content, row.photos);
}

/**
 * Rows back into the model's chat format, starting at a user message so no
 * tool result is orphaned. With `names` (the household thread) each member's
 * message says who wrote it, and members talking among themselves become one
 * user message, since the model only answers when tagged. `max` keeps the
 * newest messages, still starting at a user message.
 */
export function toHistory(rows: MessageRow[], names?: Map<string, string>, max?: number, images?: Map<string, ChatImage[]>): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const row of rows) {
    const seen = images?.get(row.id);
    if (row.role === "user" && names) {
      const line = `${(row.user_id && names.get(row.user_id)) || "Someone"}: ${userText(row)}`;
      const last = out[out.length - 1];
      if (last?.role === "user") {
        last.content = `${last.content}\n${line}`;
        if (seen?.length) last.images = [...(last.images ?? []), ...seen];
      } else out.push({ role: "user", content: line, ...(seen?.length ? { images: seen } : {}) });
    } else if (row.role === "user") out.push({ role: "user", content: userText(row), ...(seen?.length ? { images: seen } : {}) });
    else if (row.role === "assistant") {
      const calls = Array.isArray(row.tool_calls) ? (row.tool_calls as { id: string; name: string; args: Record<string, unknown> }[]) : undefined;
      out.push({ role: "assistant", content: row.content, ...(calls?.length ? { toolCalls: calls } : {}) });
    } else {
      const meta = (row.tool_calls ?? {}) as { toolCallId?: string; name?: string };
      if (meta.toolCallId && meta.name) out.push({ role: "tool", toolCallId: meta.toolCallId, name: meta.name, content: row.content });
    }
  }
  const paired = pairToolSteps(out);
  const kept = max === undefined ? paired : paired.slice(-max);
  const firstUser = kept.findIndex((m) => m.role === "user");
  return firstUser < 0 ? [] : kept.slice(firstUser);
}

/**
 * Puts each tool result right after the step that called it, as every
 * provider requires. A turn's steps used to be saved in one insert with one
 * timestamp, so reading them back could put a result before its call (and
 * Anthropic refused the whole chat). A result with no call, or a call with
 * no result, is dropped.
 */
export function pairToolSteps(messages: ChatMessage[]): ChatMessage[] {
  const results = new Map<string, ChatMessage & { role: "tool" }>();
  for (const m of messages) if (m.role === "tool") results.set(m.toolCallId, m);
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "tool") continue;
    if (m.role !== "assistant" || !m.toolCalls?.length) {
      out.push(m);
      continue;
    }
    const answered = m.toolCalls.filter((c) => results.has(c.id));
    if (answered.length) out.push({ role: "assistant", content: m.content, toolCalls: answered });
    else if (m.content) out.push({ role: "assistant", content: m.content });
    for (const c of answered) {
      out.push(results.get(c.id)!);
      results.delete(c.id);
    }
  }
  return out;
}

// ── Household context ────────────────────────────────────────────────────

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

async function householdThread(ctx: Pick<AssistantContext, "admin" | "groupId">): Promise<ConversationRow> {
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

/**
 * This person's conversations and the household thread, newest first. Archived
 * chats are left out, or with `archived` they are the only ones listed.
 */
export async function listConversations(ctx: AssistantContext, opts: { archived?: boolean } = {}): Promise<AssistantConversation[]> {
  let query = ctx.admin
    .from("assistant_conversations")
    .select("*")
    .eq("group_id", ctx.groupId)
    .eq("deleted", false);
  query = opts.archived
    ? query.eq("owner_id", ctx.userId).not("archived_at", "is", null)
    : query.or(`kind.eq.household,owner_id.eq.${ctx.userId}`).is("archived_at", null);
  const { data } = await query.order("last_active_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as ConversationRow[];
  const ids = rows.map((r) => r.id);
  const [pending, reads] = await Promise.all([pendingCounts(ctx, ids), readStates(ctx, ids)]);
  return rows.map((r) => toConversation(r, pending.get(r.id) ?? 0, isUnread(r.last_active_at, reads.get(r.id))));
}

/** How many chats this person has archived, for the "Archived" link. */
export async function archivedCount(ctx: AssistantContext): Promise<number> {
  const { count } = await ctx.admin
    .from("assistant_conversations")
    .select("id", { count: "exact", head: true })
    .eq("group_id", ctx.groupId)
    .eq("owner_id", ctx.userId)
    .eq("deleted", false)
    .not("archived_at", "is", null);
  return count ?? 0;
}

/** A conversation's messages. Callers check the person may see it (findConversation), which can run alongside. */
export async function conversationMessages(ctx: AssistantContext, conversationId: string): Promise<AssistantMessage[]> {
  const [{ data }, names] = await Promise.all([
    ctx.admin.from("assistant_messages").select("*").eq("conversation_id", conversationId).eq("group_id", ctx.groupId).order("created_at", { ascending: true }).limit(500),
    memberNames(ctx.admin, ctx.groupId),
  ]);
  const rows = (data ?? []) as MessageRow[];
  const urls = await rowPhotoUrls(ctx.admin, rows);
  return rows.flatMap((r) => toMessage(r, names, ctx.userId, urls) ?? []);
}

// ── A turn ────────────────────────────────────────────────────────────────

export interface ChatInput {
  text: string;
  conversationId?: string | null;
  kind?: ConversationKind;
  channel?: MessageChannel;
  /** Carry on a quick ask that has closed, with its history, instead of refusing. */
  reopen?: boolean;
  /** When the request reached the server (Date.now()), so the log shows sign-in and the cold start too. */
  receivedAt?: number;
  /** How long the app waited for its previous reply, end to end, as it measured it. */
  lastWaitMs?: number;
  /** The turn as it happens, for a streamed reply (HOUP-509). */
  onStream?: (event: TurnStreamEvent) => void;
  /** Asked from cook mode (Recipes v2 R7): the recipe and step on screen. */
  cook?: CookAskContext | null;
  /** Asked from the pop-up chat: the route of the screen behind it (cleanScreenPath). */
  screen?: string | null;
  /** Photos sent with the message: storage paths the caller checked belong to this person (isAssistantPhotoPathFor). */
  photos?: string[];
}

export type ChatOutcome =
  | {
      ok: true;
      conversation: AssistantConversation;
      messages: AssistantMessage[];
      budget: BudgetCheck["status"];
      /** Bookkeeping that can wait until the reply is sent: folding older messages into the summary. */
      afterReply: () => Promise<void>;
      /** A member's message in the household thread, for the other members' push. */
      posted?: AssistantMessage;
    }
  | { ok: false; status: number; error: string; code?: AssistantErrorCode };

function priceTable(): Record<string, { input: number; output: number }> {
  return { ...MODEL_PRICES, ...parseModelPrices(process.env.ASSISTANT_MODEL_PRICES) };
}

/** Spend for one turn in micro-dollars: listed price, else free for a local server, else the fallback price. */
export function turnCost(brain: Pick<AssistantBrain, "free" | "extraPrices">, model: string, input: number, output: number): number {
  const prices = { ...priceTable(), ...brain.extraPrices };
  return costMicros(model, input, output, prices) ?? (brain.free ? 0 : costMicros(model, input, output, { [model]: FALLBACK_MODEL_PRICE })!);
}

/**
 * The household's models (provider.ts resolveAssistantBrain): its picks when
 * allowed, its own key (HOUP-436) when it has one, else the server's.
 */
export async function assistantBrain(
  admin: SupabaseClient,
  groupId: string,
  choice?: Promise<{ chat: string | null; quick: string | null }> | { chat: string | null; quick: string | null }
): Promise<AssistantBrain | null> {
  const [keys, lookup, picked] = await Promise.all([householdKeys(admin, groupId), resolveServerKeys(SERVER_BRAIN_KEYS), choice]);
  return resolveAssistantBrain({ lookup, householdKeys: keys, choice: picked });
}

export interface ChatDeps {
  brain?: AssistantBrain | null;
  llm?: LlmClient;
  now?: Date;
}

/**
 * One line per turn in the server log, so "it feels slow" can be answered
 * from the logs: the reads before the turn, the conversation and history,
 * gathering tools (Home Assistant's listing), each model call, each tool
 * that ran, and the whole request. Search the logs for "[assistant] timing".
 */
/**
 * The chat route has 60 s (maxDuration). Past TURN_ANSWER_BY_MS the model
 * answers with what it has; a model call still running at TURN_GIVE_UP_MS
 * ends the turn with a clear error, leaving time to say so before the
 * platform cuts the request off with a bare 504.
 */
export const TURN_ANSWER_BY_MS = 35_000;

const PHOTO_MISSING = "A photo didn't finish uploading. Attach it again.";

/** Added to the system prompt when photos are in play. */
export const PHOTO_PROMPT =
  "\n\nPhotos: the person can send photos, such as receipts, bills, letters, bin calendars, recipe pages, products and documents. " +
  "Read them carefully and use your tools to put what they show where it belongs (a receipt becomes a cost, a recipe page a saved recipe, a product a Shopper watch, collection days the bin schedule). " +
  "If it isn't clear what they want done with a photo, say what you see and ask. " +
  "Chat photos are deleted after a while; when a photo is worth keeping (a receipt, warranty, letter or document), offer to file it in Documents with file_photo.";
export const TURN_GIVE_UP_MS = 52_000;

function logTurnTiming(t: Record<string, unknown>) {
  console.info(`[assistant] timing ${JSON.stringify(t)}`);
}

export async function runChat(ctx: AssistantContext, input: ChatInput, deps: ChatDeps = {}): Promise<ChatOutcome> {
  const text = input.text.trim();
  const photos = input.photos ?? [];
  if (!text && !photos.length) return { ok: false, status: 400, error: "Say something first." };
  const started = Date.now();
  // Photos are fetched and shrunk while everything else is read.
  const preparing = photos.length ? preparePhotos(ctx.admin, photos) : Promise.resolve(null);
  preparing.catch(() => {});
  // Everything a turn needs before the model runs is read in two parallel
  // rounds, not one query after another: each read is a database round trip.
  const loadingSettings = loadSettings(ctx.admin, ctx.groupId);
  const [brain, settings, limits, usage, found] = await Promise.all([
    deps.brain === undefined
      ? assistantBrain(ctx.admin, ctx.groupId, loadingSettings.then((s) => ({ chat: s.chatModel, quick: s.quickModel })))
      : Promise.resolve(deps.brain),
    loadingSettings,
    loadMemberLimits(ctx.admin, ctx.groupId, ctx.userId),
    monthUsage(ctx.admin, ctx.groupId),
    input.conversationId ? findConversation(ctx, input.conversationId) : Promise.resolve(null),
  ]);
  // The household thread is the members' chat room: a message that doesn't
  // tag Rooftap is just posted, with no model, key or budget involved.
  const roomKind = input.conversationId ? found?.kind : input.kind;
  if (roomKind === "household" && !wantsAssistantReply("household", input.channel ?? "app", text)) {
    if (input.conversationId && !found) return { ok: false, status: 404, error: "Not found" };
    if (photos.length && !(await preparing)) return { ok: false, status: 400, error: PHOTO_MISSING };
    return postToHousehold(ctx, found ?? (await householdThread(ctx)), text, input.channel ?? "app", deps.now ?? new Date(), photos);
  }
  if (!brain) return { ok: false, status: 503, error: "No AI model is set up on this server yet.", code: "assistant_not_configured" };
  const budget = budgetFor(usage, ctx.userId, settings, limits.budgetCents, ctx.access, brain.keySource);
  if (budget.action === "stop") {
    return { ok: false, status: 402, error: "This month's assistant budget is used up.", code: "assistant_budget_reached" };
  }

  // Which model answers, decided before anything is written: a turn with
  // photos needs one that can look at them.
  const turnKind: ConversationKind = found?.kind ?? (input.kind === "household" ? "household" : input.kind === "chat" ? "chat" : "quick");
  const useCheap = budget.action === "cheap" || turnKind === "quick";
  // The quick model may live on another provider or key (brain.quickBrain).
  let active = useCheap && brain.quickBrain ? brain.quickBrain : brain;
  let other = useCheap ? brain : brain.quickBrain ?? brain;
  let chosenModel = useCheap ? active.quickModel : brain.chatModel;
  let otherModel = useCheap ? brain.chatModel : other.quickModel;
  if (photos.length && !brainTakesPhotos(active, chosenModel)) {
    if (!brainTakesPhotos(other, otherModel)) {
      return { ok: false, status: 400, error: "The household's AI model can't look at photos. Send it as words, or pick a model that reads photos in Settings > Assistant.", code: "assistant_photos_unsupported" };
    }
    [active, other, chosenModel, otherModel] = [other, active, otherModel, chosenModel];
  }
  const readMs = Date.now() - started;

  // The tools (Home Assistant's may be a round trip away) are gathered while
  // the conversation and its history are read.
  const toolsStarted = Date.now();
  // In the household thread every member reads the reply (shared).
  const gathering = turnTools(ctx, settings, limits.readOnly, { deviceId: input.cook?.deviceId, shared: roomKind === "household" }).then(
    (r) => ({ ...r, ms: Date.now() - toolsStarted })
  );
  // Settled here so a failed read below can't leave it rejecting unheard.
  gathering.catch(() => {});

  const now = deps.now ?? new Date();
  let conversation: ConversationRow;
  if (input.conversationId) {
    if (!found) return { ok: false, status: 404, error: "Not found" };
    if (!isConversationOpen(found.kind, found.closes_at, now) && !(input.reopen && found.kind === "quick")) {
      return { ok: false, status: 409, error: "This quick ask has closed. Start a new one.", code: "assistant_conversation_closed" };
    }
    conversation = found;
  } else if (input.kind === "household") {
    conversation = await householdThread(ctx);
  } else {
    conversation = await startConversation(ctx, input.kind === "chat" ? "chat" : "quick", text || "Photo", settings.quickAskIdleMinutes);
  }

  const [{ data: recent }, { data: memoryRows }, names, timeZone, cooking] = await Promise.all([
    ctx.admin
      .from("assistant_messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(settings.contextMessages * 3),
    ctx.admin.from("assistant_memories").select("text").eq("group_id", ctx.groupId).eq("deleted", false).order("created_at").limit(60),
    memberNames(ctx.admin, ctx.groupId),
    userTimeZone(ctx.admin, ctx.userId),
    input.cook && ctx.enabled.has("recipes") ? cookingContext(ctx, input.cook, now.getTime()) : Promise.resolve(null),
    // Sending is reading: anything before this turn is no longer news to them.
    markConversationRead(ctx, conversation.id, { at: now }),
  ]);
  const household = conversation.kind === "household";
  const rows = ((recent ?? []) as MessageRow[]).reverse();
  // Photos from one of the last two messages people sent go to the model
  // again, so a follow-up about them ("also add the tip") still works;
  // older ones are only a note, to keep each turn's cost down.
  const lookAgain = brainTakesPhotos(active, chosenModel)
    ? rows.filter((r) => r.role === "user").slice(-2).reverse().find((r) => r.photos?.length)
    : undefined;
  const [seenAgain, images] = await Promise.all([
    lookAgain ? loadKeptPhotos(ctx.admin, lookAgain.photos!) : Promise.resolve([]),
    preparing,
  ]);
  if (photos.length && !images) return { ok: false, status: 400, error: PHOTO_MISSING };
  const history = toHistory(
    rows,
    household ? names : undefined,
    settings.contextMessages * 3,
    lookAgain && seenAgain.length ? new Map([[lookAgain.id, seenAgain]]) : undefined
  );

  const contextMs = Date.now() - started - readMs;
  const { tools, homeAssistant, ms: toolsMs } = await gathering;
  const reachable = [...new Set(tools.map((t) => t.module))].filter((m): m is ModuleId => m !== HOME_ASSISTANT_SCOPE);
  const system = buildAssistantSystemPrompt({
    now: formatNow(timeZone, now),
    timeZone,
    person: names.get(ctx.userId) ?? "a household member",
    members: [...names.values()],
    modules: [
      ...reachable.map((m) => ({
        label: getModule(m)?.label ?? m,
        trust: limits.readOnly ? "read" : trustFor(settings.trust, m),
      })),
      ...(homeAssistant
        ? [
            {
              label: homeAssistant.unavailable ? `${HOME_ASSISTANT_LABEL} (unavailable right now: ${homeAssistant.unavailable})` : HOME_ASSISTANT_LABEL,
              trust: homeAssistant.trust,
            },
          ]
        : []),
    ],
    off: [...new Set(MCP_TOOLS.map((t) => t.module))].filter((m) => !reachable.includes(m)).map((m) => getModule(m)?.label ?? m),
    memories: ((memoryRows ?? []) as { text: string }[]).map((m) => m.text),
    kind: conversation.kind,
    channel: input.channel ?? "app",
    summary: conversation.summary,
    cooking,
    screen: input.screen,
  }) + (photos.length || lookAgain ? PHOTO_PROMPT : "");

  const channel = input.channel ?? "app";
  // A busy model (the provider's 503 after its own retries) hands the turn to
  // the household's other model, or to another provider the server has a key for.
  const llm = withFallbackModel(
    deps.llm ?? llmClient(active.connection),
    // A turn with photos only falls back to a model that can see them.
    photos.length && !brainTakesPhotos(other, otherModel)
      ? null
      : other === active
      ? otherModel !== chosenModel
        ? otherModel
        : async () => {
            const backup = deps.llm ? null : await resolveBackupBrain(active);
            return backup ? { llm: llmClient(backup.connection), model: useCheap ? backup.quickModel : backup.chatModel } : null;
          }
      : async () => (deps.llm ? null : { llm: llmClient(other.connection), model: otherModel })
  );

  // The person's message is saved while the model works on it.
  const savingUser = ctx.admin
    .from("assistant_messages")
    .insert({ conversation_id: conversation.id, group_id: ctx.groupId, user_id: ctx.userId, role: "user", content: text, channel, ...(photos.length ? { photos } : {}) })
    .select("*")
    .single()
    // A query builder only runs once something awaits it; start it now.
    .then((r) => r);

  let turn;
  try {
    // In the household thread the model sees who is asking, like the messages before.
    const said = withPhotoNote(text, photos);
    const userText = household ? `${names.get(ctx.userId) ?? "Someone"}: ${said}` : said;
    turn = await runAssistantTurn({
      llm,
      model: chosenModel,
      system,
      history,
      userText,
      ...(images?.length ? { userImages: images } : {}),
      tools,
      deadline: { answerBy: started + TURN_ANSWER_BY_MS, giveUpAt: started + TURN_GIVE_UP_MS },
      onEvent: (e) => console.info(`[assistant] step ${JSON.stringify({ conversation: conversation.id, ...e })}`),
      ...(input.onStream ? { onStream: input.onStream } : {}),
    });
  } catch (e) {
    if (e instanceof TurnTimeoutError) {
      logTurnTiming({ conversation: conversation.id, model: llm.model() ?? chosenModel, timedOut: true, totalMs: Date.now() - started, readMs, contextMs, toolsMs });
      return { ok: false, status: 504, error: "Rooftap took too long to answer. Try again, or ask for less at once." };
    }
    console.error("[assistant] turn failed", e);
    // Owners see the provider's reason, so a bad key or model name can be fixed without the server logs.
    const reason = ctx.isOwner && e instanceof Error ? ` (${e.message.slice(0, 200)})` : "";
    const busy = isProviderBusy(e) ? "The AI model is busy right now (the provider is overloaded). Try again in a minute." : "The AI model didn't answer. Try again in a moment.";
    return { ok: false, status: 502, error: `${busy}${reason}` };
  }

  const turnMs = Date.now() - started - readMs - contextMs;
  const { data: userRow, error: userErr } = await savingUser;
  if (userErr || !userRow) return { ok: false, status: 500, error: userErr?.message ?? "Could not save the message" };

  // The model that answered, which is the fallback if the first was busy.
  const model = llm.model() ?? chosenModel;
  const cost = turnCost(active, model, turn.inputTokens, turn.outputTokens);
  // Steps before the final answer are stored for the model's memory of the
  // turn; only the last one carries the proposals, tokens and cost.
  // Each row gets its own time, a millisecond apart, so the turn reads back
  // in order (one insert would stamp them all alike).
  const savedAt = Date.now();
  const steps = turn.messages.slice(0, -1).map((m, i) => ({
    created_at: new Date(savedAt + i).toISOString(),
    conversation_id: conversation.id,
    group_id: ctx.groupId,
    user_id: ctx.userId,
    role: m.role,
    content: m.content,
    tool_calls: m.role === "assistant" ? m.toolCalls ?? null : m.role === "tool" ? { toolCallId: m.toolCallId, name: m.name } : null,
    channel,
  }));
  if (steps.length) await ctx.admin.from("assistant_messages").insert(steps);
  const items = turn.proposals.map((p) => ({ ...p, summary: describeProposal(p.tool, p.module as AssistantScope, p.args) }));
  const { data: replyRow } = await ctx.admin
    .from("assistant_messages")
    .insert({
      created_at: new Date(savedAt + steps.length).toISOString(),
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

  const touched = {
    // When the reply landed, so it reads as news to anyone who hasn't seen it.
    last_active_at: new Date(Math.max(Date.now(), now.getTime())).toISOString(),
    // Talking in an archived chat brings it back to the list.
    ...(conversation.archived_at ? { archived_at: null } : {}),
    ...(conversation.kind === "quick" ? { closes_at: quickAskClosesAt(now, settings.quickAskIdleMinutes).toISOString() } : {}),
  };
  // The bookkeeping after the reply doesn't depend on itself, so it goes in one round.
  const [pending] = await Promise.all([
    pendingCounts(ctx, [conversation.id]),
    turn.memories.length
      ? ctx.admin
          .from("assistant_memories")
          .insert(turn.memories.map((m) => ({ group_id: ctx.groupId, text: m.slice(0, 500), source: "agent", created_by: ctx.userId })))
      : null,
    ctx.admin.rpc("assistant_record_usage", {
      p_group_id: ctx.groupId,
      p_user_id: ctx.userId,
      p_month: usageMonth(now),
      p_feature: channel === "telegram" ? "telegram" : conversation.kind === "quick" ? "quick" : conversation.kind,
      p_model: model,
      p_key_source: active.keySource,
      p_input_tokens: turn.inputTokens,
      p_output_tokens: turn.outputTokens,
      p_cost_micros: cost,
    }),
    ctx.admin.from("assistant_conversations").update(touched).eq("id", conversation.id),
    // A reply sent to Telegram was read there.
    channel !== "app" ? markConversationRead(ctx, conversation.id, { at: new Date(touched.last_active_at) }) : null,
  ]);

  logTurnTiming({
    conversation: conversation.id,
    model,
    totalMs: Date.now() - started,
    ...(input.receivedAt ? { requestMs: Date.now() - input.receivedAt, authMs: started - input.receivedAt } : {}),
    ...(input.lastWaitMs ? { lastAppWaitMs: input.lastWaitMs } : {}),
    readMs,
    contextMs,
    toolsMs,
    turnMs,
    llmMs: turn.timing.llmMs,
    tools: turn.timing.tools,
    proposals: items.length,
  });

  // This month's usage as read before the turn, plus the turn itself.
  const after = budgetFor(
    [...usage, { user_id: ctx.userId, key_source: active.keySource, cost_micros: cost }],
    ctx.userId,
    settings,
    limits.budgetCents,
    ctx.access,
    active.keySource
  );
  const urls = photos.length ? await photoUrls(ctx.admin, photos) : undefined;
  const messages = [userRow as MessageRow, replyRow as MessageRow].flatMap((r) => (r ? toMessage(r, names, ctx.userId, urls) ?? [] : []));
  return {
    ok: true,
    conversation: toConversation({ ...conversation, ...touched }, pending.get(conversation.id) ?? 0),
    messages,
    posted: household && channel === "app" ? messages[0] : undefined,
    budget: after.status,
    afterReply: () =>
      Promise.all([
        foldOlderMessages(ctx, conversation, {
        llm: deps.llm ?? llmClient((brain.quickBrain ?? brain).connection),
        model: (brain.quickBrain ?? brain).quickModel,
        window: settings.contextMessages * 3,
        brain: brain.quickBrain ?? brain,
        feature: channel === "telegram" ? "telegram" : conversation.kind,
        names,
      }).catch((e) => console.error("[assistant] summary fold failed", e)),
        // Photos past the household's keep time go, a day at a time.
        sweepOldPhotos(ctx.admin, ctx.groupId, assistantPhotoKeepDays(ctx.tier ?? "free")).catch((e) =>
          console.error("[assistant] photo sweep failed", e)
        ),
      ]).then(() => undefined),
  };
}

/** A member's message in the household chat room, with no answer from Rooftap. */
async function postToHousehold(
  ctx: AssistantContext,
  conversation: ConversationRow,
  text: string,
  channel: MessageChannel,
  now: Date,
  photos: readonly string[] = []
): Promise<ChatOutcome> {
  const [{ data: row, error }, names] = await Promise.all([
    ctx.admin
      .from("assistant_messages")
      .insert({ conversation_id: conversation.id, group_id: ctx.groupId, user_id: ctx.userId, role: "user", content: text, channel, ...(photos.length ? { photos } : {}) })
      .select("*")
      .single(),
    memberNames(ctx.admin, ctx.groupId),
  ]);
  if (error || !row) return { ok: false, status: 500, error: error?.message ?? "Could not save the message" };
  const touched = {
    last_active_at: (row as MessageRow).created_at ?? now.toISOString(),
    ...(conversation.archived_at ? { archived_at: null } : {}),
  };
  const [pending] = await Promise.all([
    pendingCounts(ctx, [conversation.id]),
    ctx.admin.from("assistant_conversations").update(touched).eq("id", conversation.id),
    // Their own message is never news to them.
    markConversationRead(ctx, conversation.id, { at: new Date(touched.last_active_at) }),
  ]);
  const message = toMessage(row as MessageRow, names, ctx.userId, photos.length ? await photoUrls(ctx.admin, photos) : undefined)!;
  return {
    ok: true,
    conversation: toConversation({ ...conversation, ...touched }, pending.get(conversation.id) ?? 0),
    messages: [message],
    budget: "ok",
    afterReply: async () => {},
    posted: message,
  };
}

/**
 * Posts a server note (the weekly money digest) to the household thread as
 * the assistant, on the 'routine' channel. Null when a note starting with
 * the same `marker` went out in the last `quietDays`, so a cron that runs
 * twice posts once.
 */
export async function postHouseholdRoutine(
  admin: SupabaseClient,
  groupId: string,
  text: string,
  opts: { marker: string; quietDays: number; now?: Date }
): Promise<{ conversation: AssistantConversation; message: AssistantMessage } | null> {
  const now = opts.now ?? new Date();
  const conversation = await householdThread({ admin, groupId });
  const { data: recent } = await admin
    .from("assistant_messages")
    .select("id")
    .eq("conversation_id", conversation.id)
    .eq("channel", "routine")
    .like("content", `${opts.marker}%`)
    .gte("created_at", new Date(now.getTime() - opts.quietDays * 86_400_000).toISOString())
    .limit(1);
  if (recent?.length) return null;
  const { data: row, error } = await admin
    .from("assistant_messages")
    .insert({ conversation_id: conversation.id, group_id: groupId, user_id: null, role: "assistant", content: text, channel: "routine" })
    .select("*")
    .single();
  if (error || !row) throw new Error(error?.message ?? "Could not save the note");
  const touched = {
    last_active_at: (row as MessageRow).created_at ?? now.toISOString(),
    ...(conversation.archived_at ? { archived_at: null } : {}),
  };
  await admin.from("assistant_conversations").update(touched).eq("id", conversation.id);
  return {
    conversation: toConversation({ ...conversation, ...touched }, 0),
    message: { ...toMessage(row as MessageRow, new Map())!, author: "Rooftap" },
  };
}

// ── Rolling summary ───────────────────────────────────────────────────────

/** Folding waits until at least this many messages have left the window, so it runs now and then, not every turn. */
export const FOLD_BATCH = 8;

interface FoldOptions {
  llm: LlmClient;
  model: string;
  /** How many of the newest rows each turn sends word for word (runChat's history). */
  window: number;
  brain: Pick<AssistantBrain, "free" | "keySource">;
  feature: string;
  names: Map<string, string>;
}

/**
 * Keeps a long conversation coherent: messages that have left the context
 * window are folded into its summary (sent with every turn), a batch at a
 * time, after the reply is out. A server without summary_through skips it.
 */
export async function foldOlderMessages(ctx: AssistantContext, conversation: ConversationRow, opts: FoldOptions): Promise<void> {
  if (conversation.summary_through === undefined) return;
  // The oldest row still inside the window; anything before it has left.
  const { data: edge } = await ctx.admin
    .from("assistant_messages")
    .select("created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .range(opts.window - 1, opts.window - 1)
    .maybeSingle();
  if (!edge) return;
  let query = ctx.admin
    .from("assistant_messages")
    .select("role, content, user_id, created_at")
    .eq("conversation_id", conversation.id)
    .in("role", ["user", "assistant"])
    .lt("created_at", (edge as { created_at: string }).created_at)
    .order("created_at", { ascending: true })
    .limit(200);
  if (conversation.summary_through) query = query.gt("created_at", conversation.summary_through);
  const { data } = await query;
  const rows = ((data ?? []) as Pick<MessageRow, "role" | "content" | "user_id" | "created_at">[]).filter((r) => r.content?.trim());
  if (rows.length < FOLD_BATCH) return;

  const step = await opts.llm({
    model: opts.model,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: summaryRequest(
          conversation.summary,
          rows.map((r) => ({ speaker: r.role === "assistant" ? "Rooftap" : (r.user_id && opts.names.get(r.user_id)) || "Someone", text: r.content }))
        ),
      },
    ],
    tools: [],
    maxTokens: 400,
  });
  const summary = step.text.trim();
  if (!summary) return;
  const cost = turnCost(opts.brain, opts.model, step.inputTokens, step.outputTokens);
  await Promise.all([
    ctx.admin
      .from("assistant_conversations")
      .update({ summary: summary.slice(0, 2000), summary_through: rows[rows.length - 1].created_at })
      .eq("id", conversation.id),
    ctx.admin.rpc("assistant_record_usage", {
      p_group_id: ctx.groupId,
      p_user_id: ctx.userId,
      p_month: usageMonth(new Date()),
      p_feature: opts.feature,
      p_model: opts.model,
      p_key_source: opts.brain.keySource,
      p_input_tokens: step.inputTokens,
      p_output_tokens: step.outputTokens,
      p_cost_micros: cost,
    }),
  ]);
}

// ── Proposals ─────────────────────────────────────────────────────────────

export type DecisionOutcome =
  | { ok: true; message: AssistantMessage; outcome: AssistantMessage | null }
  | { ok: false; status: number; error: string };

/** `picks` (from the card's ticks) narrows a confirm to the kept rows; none kept counts as "not now". */
export async function decideProposal(
  ctx: AssistantContext,
  messageId: string,
  asked: "confirm" | "decline",
  picks?: ProposalPick[]
): Promise<DecisionOutcome> {
  const { data } = await ctx.admin.from("assistant_messages").select("*").eq("id", messageId).eq("group_id", ctx.groupId).maybeSingle();
  const row = data as MessageRow | null;
  if (!row || !(await findConversation(ctx, row.conversation_id))) return { ok: false, status: 404, error: "Not found" };
  if (row.proposal_state !== "pending") return { ok: false, status: 409, error: "Already decided." };

  const stored = row.proposal?.items ?? [];
  const chosen = asked === "confirm" && picks ? applyProposalPicks(stored, picks) : stored;
  const decision = asked === "confirm" && chosen.length === 0 ? "decline" : asked;
  // The card keeps what was actually done, so a partial yes reads as such later.
  const proposal = chosen === stored || decision === "decline" ? row.proposal : { ...row.proposal, items: chosen };

  // Claim it first, so a double tap can't apply the same change twice.
  const next: ProposalState = decision === "confirm" ? "confirmed" : "declined";
  const { data: claimed } = await ctx.admin
    .from("assistant_messages")
    .update({ proposal_state: next, ...(proposal !== row.proposal ? { proposal } : {}) })
    .eq("id", messageId)
    .eq("proposal_state", "pending")
    .select("id");
  if (!claimed?.length) return { ok: false, status: 409, error: "Already decided." };

  const started = Date.now();
  // What a confirmed change needs is read in one round, not one query after another.
  const [names, settings, limits] = await Promise.all([
    memberNames(ctx.admin, ctx.groupId),
    decision === "confirm" ? loadSettings(ctx.admin, ctx.groupId) : null,
    decision === "confirm" ? loadMemberLimits(ctx.admin, ctx.groupId, ctx.userId) : null,
  ]);
  const who = names.get(ctx.userId) ?? "Someone";
  let note: string;
  let toolsMs = 0;
  let runMs = 0;
  if (decision === "decline" || !settings || !limits) {
    note = `${who} said not now, so nothing was changed.`;
  } else {
    const { tools } = await turnTools(ctx, settings, limits.readOnly);
    toolsMs = Date.now() - started;
    const items = proposalItems({ ...row, proposal });
    const outcomes = await executeProposals(
      chosen.map((p) => ({ toolCallId: p.toolCallId, tool: p.tool, module: p.module, args: p.args })),
      tools
    );
    runMs = Date.now() - started - toolsMs;
    const done = items.filter((_, i) => outcomes[i]?.ok).map((i) => i.summary);
    // The reason goes into the note, so the person (and the next turn's model) knows why.
    const failed = items.flatMap((item, i) => {
      const outcome = outcomes[i];
      if (outcome?.ok) return [];
      const reason = outcome ? failureReason(outcome.text) : "";
      console.warn("[assistant] change failed", JSON.stringify({ conversation: row.conversation_id, tool: outcome?.tool, args: item.args, reason }));
      return [reason ? `${item.summary} (${reason})` : item.summary];
    });
    note = [
      done.length ? `Done: ${done.join("; ")}.` : null,
      failed.length ? `Couldn't do: ${failed.join("; ")}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  // A plain assistant line, so the next turn's model knows what happened.
  const [{ data: outcomeRow }] = await Promise.all([
    ctx.admin
      .from("assistant_messages")
      .insert({ conversation_id: row.conversation_id, group_id: ctx.groupId, user_id: ctx.userId, role: "assistant", content: note, channel: row.channel })
      .select("*")
      .single(),
    ctx.admin.from("assistant_conversations").update({ last_active_at: new Date().toISOString() }).eq("id", row.conversation_id),
  ]);
  if (decision === "confirm") logTurnTiming({ conversation: row.conversation_id, confirm: true, totalMs: Date.now() - started, toolsMs, runMs });

  const updated = toMessage({ ...row, proposal, proposal_state: next }, names, ctx.userId)!;
  return { ok: true, message: updated, outcome: outcomeRow ? toMessage(outcomeRow as MessageRow, names, ctx.userId) : null };
}

