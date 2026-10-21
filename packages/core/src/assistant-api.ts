// Rooftap Assistant: what /api/assistant/* sends and receives, and one client
// both apps build on (HOUP-443). Each app passes its own `call` (web: a
// same-origin fetch; native: the server origin plus the Supabase session as
// a Bearer token), so the request shapes can't drift between platforms.

import type {
  AssistantAccess,
  AssistantSettings,
  ConversationKind,
  MessageChannel,
  ProposalState,
  TrustLevel,
} from './assistant';
import type { UsageSummary } from './assistant-usage';
import type { ModuleId } from './modules';

export interface AssistantConversation {
  id: string;
  kind: ConversationKind;
  title: string | null;
  pinned: boolean;
  last_active_at: string;
  closes_at: string | null;
  /** Proposals in this conversation waiting for an OK. */
  pending: number;
  /** Something happened here since this person last read it. Missing from servers before assistant_reads. */
  unread?: boolean;
}

export interface ProposalItem {
  tool: string;
  module: ModuleId;
  args: Record<string, unknown>;
  /** One line for the card, e.g. `Add "Milk" to Groceries`. */
  summary: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Who wrote it, for user messages in the household thread. */
  author: string | null;
  channel: MessageChannel;
  created_at: string;
  proposal: { items: ProposalItem[]; state: ProposalState } | null;
  /** Spend for this reply in micro-dollars, when known. */
  cost_micros: number | null;
}

export interface AssistantMemory {
  id: string;
  text: string;
  source: 'agent' | 'manual';
  created_at: string;
}

export interface AssistantStatus {
  access: AssistantAccess;
  /** A model is configured on the server (or the household has a key). */
  ready: boolean;
  /** Proposals waiting on this person across their conversations. */
  pending: number;
  /** This month's household spend in cents. */
  spentCents: number;
  isOwner: boolean;
  /** Conversations with something this person hasn't read. Missing from servers before assistant_reads. */
  unread?: number;
}

/** One person's say over "it answered" pushes (assistant_notify_prefs). */
export interface AssistantNotifyPrefs {
  /** A reply that lands after you left sends a push. */
  replies: boolean;
  /** The push shows the reply's text, not just "Rooftap answered". */
  preview: boolean;
}

export interface ChatResponse {
  conversation: AssistantConversation;
  /** The person's message and the reply, as stored. */
  messages: AssistantMessage[];
  /** Budget state after this turn, for a warning line. */
  budget: 'ok' | 'warn' | 'over';
}

/** One person's allowance and what they've spent this month. */
export interface AssistantMemberUsage {
  userId: string;
  name: string;
  /** Monthly allowance in cents; null means no personal limit. */
  budgetCents: number | null;
  readOnly: boolean;
  spentMicros: number;
}

export interface AssistantUsage {
  /** First day of the month shown, e.g. "2026-10-01". */
  month: string;
  summary: UsageSummary;
  /** The household budget, or null for none. */
  budgetCents: number | null;
  warnAtPercent: number;
  /** Plus allowance on Rooftap's key when it applies, in cents. */
  allowanceCents: number | null;
  /** Spend on Rooftap's key this month, which the Plus allowance counts. */
  serverMicros: number;
  members: AssistantMemberUsage[];
  isOwner: boolean;
}

/** Whether this server runs a Telegram bot, and the member's link to it (HOUP-446). */
export interface AssistantTelegramStatus {
  configured: boolean;
  botUsername: string | null;
  linked: { username: string | null; since: string } | null;
}

export interface AssistantTelegramCode {
  code: string;
  expiresAt: string;
  /** A t.me link that opens the bot with the code filled in, when the bot's name is known. */
  link: string | null;
}

/** Stable error codes the apps turn into sheets or lines. */
export type AssistantErrorCode =
  | 'assistant_requires_plus'
  | 'assistant_not_configured'
  | 'assistant_budget_reached'
  | 'assistant_conversation_closed';

export class AssistantApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: AssistantErrorCode | null
  ) {
    super(message);
  }
}

export type AssistantCall = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

export function createAssistantApi(call: AssistantCall) {
  return {
    status: () => call<AssistantStatus>('/api/assistant/status'),
    conversations: async () => (await call<{ conversations: AssistantConversation[] }>('/api/assistant/conversations')).conversations,
    messages: (conversationId: string) =>
      call<{ conversation: AssistantConversation; messages: AssistantMessage[] }>(
        `/api/assistant/conversations/${encodeURIComponent(conversationId)}`
      ),
    /** `seen`: the app showed a banner for the reply, so no push; it stays unread. */
    markRead: (conversationId: string, opts: { seen?: boolean } = {}) =>
      call<{ ok: true }>(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/read`, {
        method: 'POST',
        body: { seen: opts.seen === true },
      }),
    notifyPrefs: () => call<{ prefs: AssistantNotifyPrefs }>('/api/assistant/notify-prefs'),
    saveNotifyPrefs: (patch: Partial<AssistantNotifyPrefs>) =>
      call<{ prefs: AssistantNotifyPrefs }>('/api/assistant/notify-prefs', { method: 'PUT', body: patch }),
    updateConversation: (conversationId: string, patch: { title?: string; pinned?: boolean; deleted?: boolean }) =>
      call<{ ok: true }>(`/api/assistant/conversations/${encodeURIComponent(conversationId)}`, { method: 'PATCH', body: patch }),
    send: (input: { text: string; conversationId?: string | null; kind?: ConversationKind; reopen?: boolean }) =>
      call<ChatResponse>('/api/assistant/chat', { method: 'POST', body: input }),
    decide: (messageId: string, decision: 'confirm' | 'decline') =>
      call<{ message: AssistantMessage; outcome: AssistantMessage | null }>(
        `/api/assistant/proposals/${encodeURIComponent(messageId)}`,
        { method: 'POST', body: { decision } }
      ),
    settings: () => call<{ settings: AssistantSettings; isOwner: boolean }>('/api/assistant/settings'),
    saveSettings: (patch: Partial<AssistantSettings>) =>
      call<{ settings: AssistantSettings }>('/api/assistant/settings', { method: 'PUT', body: patch }),
    usage: (month?: string) =>
      call<AssistantUsage>(`/api/assistant/usage${month ? `?month=${encodeURIComponent(month)}` : ''}`),
    saveMemberLimit: (userId: string, patch: { monthlyBudgetCents?: number | null; readOnly?: boolean }) =>
      call<{ ok: true }>('/api/assistant/limits', { method: 'PUT', body: { userId, ...patch } }),
    telegramStatus: () => call<AssistantTelegramStatus>('/api/assistant/telegram'),
    telegramLinkCode: () => call<AssistantTelegramCode>('/api/assistant/telegram', { method: 'POST' }),
    telegramUnlink: () => call<{ ok: true }>('/api/assistant/telegram', { method: 'DELETE' }),
    memories: async () => (await call<{ memories: AssistantMemory[] }>('/api/assistant/memories')).memories,
    addMemory: (text: string) => call<{ memory: AssistantMemory }>('/api/assistant/memories', { method: 'POST', body: { text } }),
    removeMemory: (id: string) => call<{ ok: true }>(`/api/assistant/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}

export type AssistantApi = ReturnType<typeof createAssistantApi>;

/** Reads an error body from /api/assistant into an AssistantApiError. */
export function assistantError(status: number, body: unknown): AssistantApiError {
  const b = (body ?? {}) as { error?: string; code?: string };
  return new AssistantApiError(b.error ?? `Request failed (${status})`, status, (b.code as AssistantErrorCode) ?? null);
}

// ── Proposal summaries ──────────────────────────────────────────────────

const MODULE_NOUN: Partial<Record<ModuleId, string>> = {
  household: 'Tasks',
  calendar: 'Calendar',
  groceries: 'Groceries',
  costs: 'Budget',
  checklists: 'Checklists',
  recipes: 'Recipes',
};

function quoted(value: unknown): string {
  return typeof value === 'string' && value.trim() ? `"${value.trim()}"` : 'an item';
}

/**
 * One plain line for a proposed change, from the tool and its arguments.
 * Ids aren't shown (the model's reply names the item); unknown tools fall
 * back to a generic line so a new tool never breaks the card.
 */
export function describeProposal(tool: string, module: ModuleId, args: Record<string, unknown>): string {
  const where = MODULE_NOUN[module] ?? 'the app';
  const name = args.title ?? args.name;
  if (tool === 'add_recipe_to_groceries') return "Add a recipe's ingredients to Groceries";
  if (tool === 'add_checklist_item') return `Add ${quoted(args.label)} to a checklist`;
  if (tool === 'check_checklist_item') return args.done === false ? 'Untick a checklist item' : 'Tick a checklist item';
  if (tool.startsWith('create_')) return module === 'groceries' ? `Add ${quoted(name)} to Groceries` : `Add ${quoted(name)} to ${where}`;
  if (tool === 'complete_task') return args.done === false ? 'Mark a task not done' : 'Mark a task done';
  if (tool.startsWith('update_')) return name ? `Change ${quoted(name)} in ${where}` : `Change an item in ${where}`;
  if (tool.startsWith('delete_')) return `Remove an item from ${where}`;
  return `Make a change in ${where}`;
}

/** The trust options in the order Settings shows them, with their short labels. */
export const TRUST_OPTIONS: { value: TrustLevel; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'ask', label: 'Ask' },
  { value: 'act', label: 'Act' },
];
