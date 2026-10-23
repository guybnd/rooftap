// Rooftap Assistant: the rules both apps and the server share (HOUP-440..449).
//
// The assistant is a household agent that reads and changes switched-on
// modules through the same tool handlers as the public MCP server. This file
// holds the pure parts: trust levels, conversation shapes, the household's
// settings and their defaults, who may use it (plan and billing), spending
// limits, and model prices. Data lives in the `assistant_*` tables
// (migration 20261021020000_assistant).

import type { EntitlementTier } from '../../entitlements';
import type { ModuleId } from '../../modules';
import { catalogModelPrices } from '../../ai-providers';

// ── Trust ────────────────────────────────────────────────────────────────

/**
 * How far the assistant may go in one module, set by an owner.
 * - read: lookups only; write tools aren't offered at all.
 * - ask: every change becomes a proposal the person confirms with a tap.
 * - act: changes are made at once (no Undo yet: the person asks for the opposite change).
 * Deletes always ask, whatever the level.
 */
export type TrustLevel = 'read' | 'ask' | 'act';

export const TRUST_LEVELS: readonly TrustLevel[] = ['read', 'ask', 'act'];

export const DEFAULT_TRUST: TrustLevel = 'ask';

export function isTrustLevel(value: unknown): value is TrustLevel {
  return typeof value === 'string' && (TRUST_LEVELS as readonly string[]).includes(value);
}

/** The trust level for one module; anything unset or unknown is the default. */
export function trustFor(trust: Partial<Record<string, unknown>> | null | undefined, module: ModuleId): TrustLevel {
  const value = trust?.[module];
  return isTrustLevel(value) ? value : DEFAULT_TRUST;
}

export type ToolKind = 'read' | 'write';

/** What the brain does with one tool call under a trust level. */
export type ToolGate = 'hidden' | 'run' | 'propose';

/**
 * - A read tool always runs.
 * - A write tool is hidden under `read`, proposed under `ask`, run under `act`.
 * - A delete is proposed under both `ask` and `act`.
 */
export function toolGate(kind: ToolKind, trust: TrustLevel, isDelete = false): ToolGate {
  if (kind === 'read') return 'run';
  if (trust === 'read') return 'hidden';
  if (isDelete || trust === 'ask') return 'propose';
  return 'run';
}

/** Tool names that remove something; these always ask (see toolGate). */
export function isDeleteTool(name: string): boolean {
  return name.startsWith('delete_');
}

// ── Conversations ────────────────────────────────────────────────────────

/**
 * - quick: a one-off ask from the capture sheet, open for follow-ups until it
 *   has been idle for `quickAskIdleMinutes`.
 * - chat: a named thread a person keeps and swaps between.
 * - household: the one long-running thread per household, where Telegram
 *   talks by default. Visible to every member.
 */
export type ConversationKind = 'quick' | 'chat' | 'household';

export type MessageRole = 'user' | 'assistant' | 'tool';

export type MessageChannel = 'app' | 'telegram' | 'routine';

export type ProposalState = 'pending' | 'confirmed' | 'declined' | 'expired';

/** Whether a quick ask is still open for follow-ups. Chats and the household thread never close. */
export function isConversationOpen(
  kind: ConversationKind,
  closesAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (kind !== 'quick') return true;
  return !closesAt || new Date(closesAt) > now;
}

/** Tagging Rooftap in the household thread: `@Rooftap` anywhere in the message, any case. */
const ROOFTAP_TAG = /(^|[^\w@])@rooftap\b/i;

export function mentionsRooftap(text: string): boolean {
  return ROOFTAP_TAG.test(text);
}

/**
 * Whether a message gets an answer from the model. The household thread in
 * the app is the members' own chat room: Rooftap only answers when tagged.
 * Everywhere else (quick asks, chats, Telegram, which talks to the bot
 * directly) every message is for Rooftap.
 */
export function wantsAssistantReply(kind: ConversationKind, channel: MessageChannel, text: string): boolean {
  return kind !== 'household' || channel !== 'app' || mentionsRooftap(text);
}

/** When a quick ask closes if nothing more is said, counted from `lastActive`. */
export function quickAskClosesAt(lastActive: Date, idleMinutes: number): Date {
  return new Date(lastActive.getTime() + Math.max(1, idleMinutes) * 60_000);
}

// ── Settings ─────────────────────────────────────────────────────────────

/** What happens when a budget runs out. */
export type AtLimit = 'warn' | 'cheap' | 'stop';

export interface AssistantSettings {
  /** Per-module trust; missing modules use DEFAULT_TRUST. */
  trust: Partial<Record<ModuleId, TrustLevel>>;
  /** Model for chats and the household thread; null means the provider's default. */
  chatModel: string | null;
  /** Model for quick asks and routines, and the fallback under `cheap`; null means the provider's default. */
  quickModel: string | null;
  /** Recent messages sent with each turn; older ones are folded into the thread's summary. */
  contextMessages: number;
  quickAskIdleMinutes: number;
  /** Household budget per calendar month, in cents; null means no budget. */
  monthlyBudgetCents: number | null;
  atLimit: AtLimit;
  /** Warn once spending reaches this share of a budget. */
  warnAtPercent: number;
  showCostPerReply: boolean;
}

// Permissive on purpose: no budget and no hard stop unless an owner sets one.
export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  trust: {},
  chatModel: null,
  quickModel: null,
  contextMessages: 12,
  quickAskIdleMinutes: 30,
  monthlyBudgetCents: null,
  atLimit: 'warn',
  warnAtPercent: 80,
  showCostPerReply: false,
};

/** An `assistant_settings` row as stored. */
export interface AssistantSettingsRow {
  group_id: string;
  trust: Record<string, unknown> | null;
  chat_model: string | null;
  quick_model: string | null;
  context_messages: number | null;
  quick_ask_idle_minutes: number | null;
  monthly_budget_cents: number | null;
  at_limit: string | null;
  warn_at_percent: number | null;
  show_cost_per_reply: boolean | null;
}

function clampInt(value: number | null | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Reads a settings row (or no row) into settings, falling back to defaults field by field. */
export function parseAssistantSettings(row: Partial<AssistantSettingsRow> | null | undefined): AssistantSettings {
  const d = DEFAULT_ASSISTANT_SETTINGS;
  if (!row) return { ...d, trust: {} };
  const trust: Partial<Record<ModuleId, TrustLevel>> = {};
  for (const [module, level] of Object.entries(row.trust ?? {})) {
    if (isTrustLevel(level)) trust[module as ModuleId] = level;
  }
  const atLimit = row.at_limit === 'cheap' || row.at_limit === 'stop' || row.at_limit === 'warn' ? row.at_limit : d.atLimit;
  return {
    trust,
    chatModel: row.chat_model?.trim() || null,
    quickModel: row.quick_model?.trim() || null,
    contextMessages: clampInt(row.context_messages, 2, 100, d.contextMessages),
    quickAskIdleMinutes: clampInt(row.quick_ask_idle_minutes, 1, 24 * 60, d.quickAskIdleMinutes),
    monthlyBudgetCents:
      typeof row.monthly_budget_cents === 'number' && row.monthly_budget_cents >= 0 ? Math.round(row.monthly_budget_cents) : null,
    atLimit,
    warnAtPercent: clampInt(row.warn_at_percent, 1, 100, d.warnAtPercent),
    showCostPerReply: row.show_cost_per_reply ?? d.showCostPerReply,
  };
}

/** A person's own limits inside the household (`assistant_member_limits`). */
export interface AssistantMemberLimits {
  /** Monthly allowance in cents; null means no personal limit. */
  monthlyBudgetCents: number | null;
  /** Lookups only, whatever the household's trust levels say. */
  readOnly: boolean;
  /** Whether routines may run on this person's behalf. */
  routines: boolean;
}

export const DEFAULT_MEMBER_LIMITS: AssistantMemberLimits = { monthlyBudgetCents: null, readOnly: false, routines: true };

// ── Access (plan and billing) ────────────────────────────────────────────

/**
 * Who may use the assistant:
 * - none: hosted Free; the app shows the Plus sheet instead.
 * - allowance: hosted Plus on Rooftap's key, up to PLUS_ASSISTANT_ALLOWANCE_CENTS
 *   a month; the household's own key lifts it.
 * - unlimited: a comped household, or any server with billing off (self-host).
 */
export type AssistantAccess = 'none' | 'allowance' | 'unlimited';

/** Rooftap's spend per Plus household per month on its own key, in cents. A proposal to tune. */
export const PLUS_ASSISTANT_ALLOWANCE_CENTS = 200;

export function assistantAccess(tier: EntitlementTier, billing: 'on' | 'off'): AssistantAccess {
  if (billing === 'off' || tier === 'exempt') return 'unlimited';
  if (tier === 'plus') return 'allowance';
  return 'none';
}

// ── Spending ─────────────────────────────────────────────────────────────

export type BudgetStatus = 'ok' | 'warn' | 'over';

/** What a turn does given the spending so far. */
export type BudgetAction = 'proceed' | 'cheap' | 'stop';

export interface BudgetCheck {
  status: BudgetStatus;
  action: BudgetAction;
}

/**
 * One budget against what's been spent this month. With no budget there is
 * nothing to check. At the limit, `atLimit` decides: keep going with a
 * warning, drop to the cheap model, or stop.
 */
export function checkBudget(
  spentCents: number,
  budgetCents: number | null,
  atLimit: AtLimit,
  warnAtPercent: number
): BudgetCheck {
  if (budgetCents === null) return { status: 'ok', action: 'proceed' };
  if (spentCents >= budgetCents) {
    return { status: 'over', action: atLimit === 'stop' ? 'stop' : atLimit === 'cheap' ? 'cheap' : 'proceed' };
  }
  if (budgetCents > 0 && spentCents >= (budgetCents * warnAtPercent) / 100) return { status: 'warn', action: 'proceed' };
  return { status: 'ok', action: 'proceed' };
}

const ACTION_RANK: Record<BudgetAction, number> = { proceed: 0, cheap: 1, stop: 2 };
const STATUS_RANK: Record<BudgetStatus, number> = { ok: 0, warn: 1, over: 2 };

/** The stricter of several checks (household, person, Plus allowance). */
export function strictestBudget(...checks: BudgetCheck[]): BudgetCheck {
  return checks.reduce<BudgetCheck>(
    (worst, c) => ({
      status: STATUS_RANK[c.status] > STATUS_RANK[worst.status] ? c.status : worst.status,
      action: ACTION_RANK[c.action] > ACTION_RANK[worst.action] ? c.action : worst.action,
    }),
    { status: 'ok', action: 'proceed' }
  );
}

/** The first day of `date`'s month (UTC), as `assistant_usage.month` stores it. */
export function usageMonth(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// ── Model prices ─────────────────────────────────────────────────────────

/** US dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
}

/**
 * List prices for the verified models (ai-providers.ts), used to turn token counts into spend.
 * Prices change: an operator can override or add models with the
 * ASSISTANT_MODEL_PRICES env var (see parseModelPrices). A model that isn't
 * listed counts as unknown rather than free, so budgets still see its tokens
 * in usage; local models (Ollama and the like) should be listed at 0.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = catalogModelPrices();

/**
 * Used for a cloud model with no listed price, so a budget errs on the safe
 * side instead of counting the turn as free. Deliberately above the cheap
 * models' list prices.
 */
export const FALLBACK_MODEL_PRICE: ModelPrice = { input: 0.5, output: 2 };

/**
 * Parses `model=input/output` pairs separated by commas, e.g.
 * `qwen3:14b=0/0,gemini-3.1-flash-lite=0.1/0.4`. Malformed entries are skipped.
 */
export function parseModelPrices(raw: string | null | undefined): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  for (const part of (raw ?? '').split(',')) {
    const [name, rates] = part.split('=');
    const [input, output] = (rates ?? '').split('/').map(Number);
    if (!name?.trim() || !Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue;
    out[name.trim()] = { input, output };
  }
  return out;
}

/**
 * Cost of one call in millionths of a dollar (micro-dollars), or null when
 * the model has no known price. OpenRouter-style `vendor/model` ids also
 * match the bare model name.
 */
export function costMicros(
  model: string,
  inputTokens: number,
  outputTokens: number,
  prices: Record<string, ModelPrice> = MODEL_PRICES
): number | null {
  const price = prices[model] ?? prices[model.slice(model.indexOf('/') + 1)];
  if (!price) return null;
  return Math.round(inputTokens * price.input + outputTokens * price.output);
}

/** Micro-dollars to cents, rounded up so a run of tiny turns still shows up. */
export function microsToCents(micros: number): number {
  return Math.ceil(micros / 10_000);
}
