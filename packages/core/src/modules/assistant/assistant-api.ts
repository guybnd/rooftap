// Rooftap Assistant: what /api/assistant/* sends and receives, and one client
// both apps build on (HOUP-443). Each app passes its own `call` (web: a
// same-origin fetch; native: the server origin plus the Supabase session as
// a Bearer token), so the request shapes can't drift between platforms.

import type { ProposalPick } from './proposal-picks';
import type {
  AssistantAccess,
  AssistantSettings,
  ConversationKind,
  MessageChannel,
  ProposalState,
  TrustLevel,
} from './assistant';
import type { UsageSummary } from './assistant-usage';
import type { AiModelChoices } from '../../ai-providers';
import type { ModuleId } from '../../modules';
import {
  HOME_ASSISTANT_SCOPE,
  homeAssistantToolLabel,
  type AssistantScope,
  type HomeAssistantSaveInput,
  type HomeAssistantStatus,
  type HomeAssistantToolInfo,
} from './home-assistant';
import { createAssistantStreamReader, type AssistantStreamEvent } from './assistant-stream';
import { scoutTitle } from '../shopper/shopper-scout';
import { SEND_FEEDBACK_TOOL } from './feedback';
import { FILE_PHOTO_TOOL, type AssistantPhoto, type AssistantPhotoSlot } from './assistant-photos';

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
  /** Archived by its owner: out of the lists, under "Archived". Missing from servers before archiving. */
  archived?: boolean;
}

export interface ProposalItem {
  tool: string;
  module: AssistantScope;
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
  /** Written by the person viewing it. Older servers leave it out: every user message was theirs. */
  mine?: boolean;
  channel: MessageChannel;
  created_at: string;
  proposal: { items: ProposalItem[]; state: ProposalState } | null;
  /** Spend for this reply in micro-dollars, when known. */
  cost_micros: number | null;
  /** Photos sent with a person's message. Missing from servers before chat photos. */
  photos?: AssistantPhoto[];
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
  /** The household's model can look at photos, so the composer offers to attach one. Missing from servers before chat photos. */
  photos?: boolean;
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
  | 'assistant_conversation_closed'
  | 'assistant_photos_unsupported';

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

/**
 * POSTs `body` as JSON asking for an event stream, hands each piece of the
 * answer to `onChunk` as it arrives, and resolves with the whole answer.
 * Each app brings its own (web: fetch's body reader; native: XHR progress,
 * since React Native's fetch doesn't stream).
 */
export type AssistantStreamCall = (
  path: string,
  body: unknown,
  onChunk: (text: string) => void
) => Promise<{ status: number; contentType: string | null; text: string }>;

/** The progress events the server sends before its answer. */
export type AssistantProgressEvent = Extract<AssistantStreamEvent, { type: 'step' | 'status' | 'text' }>;

/**
 * One chat turn over a stream. A server that streams sends progress, then
 * `done` or `error`; one that predates streaming answers with plain JSON,
 * which is read as before.
 */
async function sendStreamed(stream: AssistantStreamCall, body: unknown, onEvent: (event: AssistantProgressEvent) => void): Promise<ChatResponse> {
  let done: ChatResponse | null = null;
  let failure: Extract<AssistantStreamEvent, { type: 'error' }> | null = null;
  const reader = createAssistantStreamReader((event) => {
    if (event.type === 'done') done = event.response;
    else if (event.type === 'error') failure = event;
    else onEvent(event);
  });
  const res = await stream('/api/assistant/chat', body, (chunk) => reader.push(chunk));
  if (res.contentType?.includes('text/event-stream')) {
    reader.end();
    const failed = failure as Extract<AssistantStreamEvent, { type: 'error' }> | null;
    if (failed) throw new AssistantApiError(failed.error, failed.status, failed.code ?? null);
    if (done) return done;
    throw new AssistantApiError("The reply was cut off on the way. Try again.", 502, null);
  }
  let json: unknown = {};
  try {
    json = JSON.parse(res.text);
  } catch {
    // An empty or non-JSON body: the status says what went wrong.
  }
  if (res.status < 200 || res.status >= 300) throw assistantError(res.status, json);
  return json as ChatResponse;
}

/** How long the last chat send took, end to end, in this app session. */
let lastWaitMs: number | null = null;

export function createAssistantApi(call: AssistantCall, stream?: AssistantStreamCall) {
  return {
    status: () => call<AssistantStatus>('/api/assistant/status'),
    conversations: async () => (await call<{ conversations: AssistantConversation[] }>('/api/assistant/conversations')).conversations,
    /** The list, with how many chats are archived (0 from servers before archiving). */
    conversationList: async () => {
      const body = await call<{ conversations: AssistantConversation[]; archived?: number }>('/api/assistant/conversations');
      return { conversations: body.conversations, archived: body.archived ?? 0 };
    },
    /** Only the chats this person archived. */
    archivedConversations: async () =>
      (await call<{ conversations: AssistantConversation[] }>('/api/assistant/conversations?archived=1')).conversations,
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
    updateConversation: (conversationId: string, patch: { title?: string; pinned?: boolean; deleted?: boolean; archived?: boolean }) =>
      call<{ ok: true }>(`/api/assistant/conversations/${encodeURIComponent(conversationId)}`, { method: 'PATCH', body: patch }),
    /**
     * Each send carries how long the previous reply took to arrive, so the
     * server log shows the wait as the app saw it. With `onEvent` (and a
     * stream call), the reply shows up as it is written.
     */
    send: async (
      input: {
        text: string;
        conversationId?: string | null;
        kind?: ConversationKind;
        reopen?: boolean;
        /** Asked from cook mode (Recipes v2 R7); older servers ignore it. */
        cook?: { recipeId: string; step: number; deviceId?: string | null };
        /** Uploaded photos (uploadAssistantPhoto paths) for Rooftap to look at. */
        photos?: string[];
      },
      onEvent?: (event: AssistantProgressEvent) => void
    ) => {
      const started = Date.now();
      const body = lastWaitMs === null ? input : { ...input, lastWaitMs };
      const res =
        stream && onEvent
          ? await sendStreamed(stream, body, onEvent)
          : await call<ChatResponse>('/api/assistant/chat', { method: 'POST', body });
      lastWaitMs = Date.now() - started;
      return res;
    },
    /** A one-time upload slot for a chat photo, under this person's household. */
    photoSlot: (mimeType: string) => call<AssistantPhotoSlot>('/api/assistant/photos', { method: 'POST', body: { mimeType } }),
    /**
     * `picks` makes only the kept rows (decision "pick"). A server older than
     * picking answers 400 to it and changes nothing, so a partial pick never
     * turns into "do all".
     */
    decide: (messageId: string, decision: 'confirm' | 'decline', picks?: ProposalPick[]) =>
      call<{ message: AssistantMessage; outcome: AssistantMessage | null }>(
        `/api/assistant/proposals/${encodeURIComponent(messageId)}`,
        { method: 'POST', body: picks ? { decision: 'pick', picks } : { decision } }
      ),
    /** `models` is missing on servers older than the AI providers settings; the apps then show free-text model fields. */
    settings: () => call<{ settings: AssistantSettings; isOwner: boolean; models?: AiModelChoices }>('/api/assistant/settings'),
    saveSettings: (patch: Partial<AssistantSettings>) =>
      call<{ settings: AssistantSettings }>('/api/assistant/settings', { method: 'PUT', body: patch }),
    usage: (month?: string) =>
      call<AssistantUsage>(`/api/assistant/usage${month ? `?month=${encodeURIComponent(month)}` : ''}`),
    saveMemberLimit: (userId: string, patch: { monthlyBudgetCents?: number | null; readOnly?: boolean }) =>
      call<{ ok: true }>('/api/assistant/limits', { method: 'PUT', body: { userId, ...patch } }),
    telegramStatus: () => call<AssistantTelegramStatus>('/api/assistant/telegram'),
    telegramLinkCode: () => call<AssistantTelegramCode>('/api/assistant/telegram', { method: 'POST' }),
    telegramUnlink: () => call<{ ok: true }>('/api/assistant/telegram', { method: 'DELETE' }),
    homeAssistant: () => call<HomeAssistantStatus>('/api/assistant/home-assistant'),
    /** Saves the connection; a new URL or token is tried first, and the tools it offers come back. */
    saveHomeAssistant: (input: HomeAssistantSaveInput) =>
      call<{ status: HomeAssistantStatus; tools: HomeAssistantToolInfo[] | null }>('/api/assistant/home-assistant', { method: 'PUT', body: input }),
    /** Connects with the saved token and lists the tools Home Assistant offers. */
    homeAssistantTools: () => call<{ tools: HomeAssistantToolInfo[] }>('/api/assistant/home-assistant', { method: 'POST' }),
    disconnectHomeAssistant: () => call<{ ok: true }>('/api/assistant/home-assistant', { method: 'DELETE' }),
    memories: async () => (await call<{ memories: AssistantMemory[] }>('/api/assistant/memories')).memories,
    addMemory: (text: string) => call<{ memory: AssistantMemory }>('/api/assistant/memories', { method: 'POST', body: { text } }),
    removeMemory: (id: string) => call<{ ok: true }>(`/api/assistant/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}

export type AssistantApi = ReturnType<typeof createAssistantApi>;

/** Reads an error body from /api/assistant into an AssistantApiError. */
export function assistantError(status: number, body: unknown): AssistantApiError {
  const b = (body ?? {}) as { error?: string; code?: string };
  return new AssistantApiError(b.error ?? bareError(status), status, (b.code as AssistantErrorCode) ?? null);
}

/** An error with no message from Rooftap's server: the hosting platform answered instead (a time limit, a deploy, a hiccup). */
function bareError(status: number): string {
  if (status === 504) return "Rooftap took too long to answer. Try again, or ask for less at once.";
  if (status === 502 || status === 503) return `Rooftap's server didn't answer just then (${status}). Try again in a moment.`;
  return `Request failed (${status})`;
}

// ── Proposal summaries ──────────────────────────────────────────────────

const MODULE_NOUN: Partial<Record<ModuleId, string>> = {
  household: 'Tasks',
  calendar: 'Calendar',
  groceries: 'Groceries',
  costs: 'Budget',
  checklists: 'Checklists',
  recipes: 'Recipes',
  meals: 'the meal plan',
  shopper: 'Shopper',
  occasions: 'Occasions',
  rewards: 'Rewards',
  bins: 'Bin night',
  'home-care': 'Home care',
  setup: 'Home Setup',
  documents: 'Documents',
  search: 'Home Search',
  'money-insights': 'Money insights',
};

/** Lines for the newer modules' changes (module-tools.ts on the server), or null for another tool. */
function moduleProposal(tool: string, args: Record<string, unknown>): string | null {
  switch (tool) {
    case 'add_reward_perk':
      return `Save the perk ${quoted(args.title)} in Rewards`;
    case 'mark_bins_out':
      return args.out === false ? 'Mark the bins as not out yet' : 'Mark the bins as out';
    case 'change_bin_collection':
      return args.moved_to ? 'Move a bin collection to another day' : 'Mark a bin collection as cancelled';
    case 'add_care_job':
      return typeof args.title === 'string' && args.title.trim() ? `Add ${quoted(args.title)} to Home care` : 'Add a job to Home care';
    case 'update_care_job': {
      const action = { done: 'Mark a Home care job done', skip: 'Skip a Home care job this time', snooze: 'Snooze a Home care job', pause: 'Pause a Home care job', resume: 'Resume a Home care job', hide: 'Hide a Home care job' }[String(args.action)];
      return action ?? 'Change a Home care job';
    }
    case 'watch_item':
      return `Watch the price of ${quoted(args.title)} in Shopper`;
    case 'update_watch_item':
      if (args.remove === true) return 'Take an item off the Shopper watchlist';
      return args.status === 'bought' ? 'Mark a watchlist item as bought' : 'Change an item on the Shopper watchlist';
    case 'create_checklist':
      return typeof args.title === 'string' && args.title.trim() ? `Start the checklist ${quoted(args.title)}` : 'Start a checklist from a template';
    case 'save_recipe':
      return `Save the recipe ${quoted(args.title)}`;
    case FILE_PHOTO_TOOL:
      return typeof args.title === 'string' && args.title.trim() ? `File the photo as ${quoted(args.title)} in Documents` : 'File the photo in Documents';
    case 'update_setup_item':
      if (args.status === 'installed') return 'Mark a Home Setup item as got';
      return args.status === 'needed' ? 'Put a Home Setup item back on the list' : 'Change an item in Home Setup';
    default:
      return null;
  }
}

/** "Thursday 30 Oct" for a YYYY-MM-DD night. */
function mealNightName(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${date.toLocaleDateString('en-US', { weekday: 'long' })} ${d} ${date.toLocaleDateString('en-US', { month: 'short' })}`;
}

function quoted(value: unknown): string {
  return typeof value === 'string' && value.trim() ? `"${value.trim()}"` : 'an item';
}

function bankProposal(tool: string, args: Record<string, unknown>): string | null {
  if (tool === 'make_cost_from_payment') {
    return `Make a cost line${typeof args.name === 'string' && args.name.trim() ? ` ${quoted(args.name)}` : ''} from a bank payment`;
  }
  if (tool === 'set_bank_link_rule') {
    return typeof args.match === 'string' && args.match.trim()
      ? `File bank payments matching ${quoted(args.match)} under a cost line`
      : 'Stop filing bank payments under a cost line';
  }
  if (tool === 'merge_cost_lines') return 'Merge two cost lines into one';
  if (tool !== 'update_bank_payment') return null;
  if (typeof args.cost_item_id === 'string') return 'File a bank payment under a cost line';
  if (args.cost_item_id === null) return 'Give a bank payment back to the link rules';
  if (args.hidden === true) return 'Hide a bank payment from spending';
  if (args.hidden === false) return 'Count a bank payment in spending again';
  return 'Add a note to a bank payment';
}

/**
 * One plain line for a proposed change, from the tool and its arguments.
 * Ids aren't shown (the model's reply names the item); unknown tools fall
 * back to a generic line so a new tool never breaks the card.
 */
export function describeProposal(tool: string, module: AssistantScope, args: Record<string, unknown>): string {
  const where = (module !== HOME_ASSISTANT_SCOPE && MODULE_NOUN[module]) || 'the app';
  const name = args.title ?? args.name;
  if (module === HOME_ASSISTANT_SCOPE) {
    const target = args.name ?? args.area ?? args.floor;
    return `${homeAssistantToolLabel(tool)}${typeof target === 'string' && target.trim() ? ` ${quoted(target)}` : ''} in Home Assistant`;
  }
  // The whole message, so the person sees exactly what leaves the household.
  if (tool === SEND_FEEDBACK_TOOL) return `Send this to the Rooftap team: ${quoted(args.message)}`;
  if (tool === 'start_scout') return `Ask Scout to find ${quoted(typeof args.text === 'string' ? scoutTitle({ text: args.text }) : null)}`;
  const specific = bankProposal(tool, args) ?? moduleProposal(tool, args);
  if (specific) return specific;
  if (tool === 'add_recipe_to_groceries') return "Add a recipe's ingredients to Groceries";
  if (tool === 'start_timer') {
    const minutes = typeof args.minutes === 'number' && args.minutes > 0 ? ` for ${Math.round(args.minutes)} min` : '';
    return `Start a cooking timer${typeof args.label === 'string' && args.label.trim() ? ` ${quoted(args.label)}` : ''}${minutes}`;
  }
  if (tool === 'set_meal') {
    const night = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? ` for ${mealNightName(args.date)}` : '';
    if (args.clear === true) return `Clear the dinner${night} on the meal plan`;
    if (typeof args.remove_recipe_id === 'string' && !args.recipe_id) return `Take a dish off the dinner${night} on the meal plan`;
    if (args.add === true) return `Add a dish to the dinner${night} on the meal plan`;
    if (typeof args.label === 'string' && args.label.trim() && !args.recipe_id) return `Put ${quoted(args.label)}${night} on the meal plan`;
    return `Plan a dinner${night} on the meal plan`;
  }
  if (tool === 'add_gift_ideas' || tool === 'add_wishlist_items') {
    const list = Array.isArray(args.ideas) ? args.ideas : Array.isArray(args.items) ? args.items : [];
    const first = list[0] as { title?: unknown } | undefined;
    const what = list.length === 1 ? quoted(first?.title) : `${list.length} things`;
    return tool === 'add_gift_ideas' ? `Add ${what} as gift ideas in Occasions` : `Add ${what} to your wishlist`;
  }
  if (tool === 'add_occasion') return typeof args.title === 'string' && args.title.trim() ? `Add ${quoted(args.title)} to Occasions` : 'Add an occasion to Occasions';
  if (tool === 'add_checklist_item') return `Add ${quoted(args.label)} to a checklist`;
  if (tool === 'check_checklist_item') return args.done === false ? 'Untick a checklist item' : 'Tick a checklist item';
  if (tool.startsWith('create_')) return module === 'groceries' ? `Add ${quoted(name)} to Groceries` : `Add ${quoted(name)} to ${where}`;
  if (tool === 'complete_task') return args.done === false ? 'Mark a task not done' : 'Mark a task done';
  if (tool.startsWith('update_')) return name ? `Change ${quoted(name)} in ${where}` : `Change an item in ${where}`;
  if (tool.startsWith('delete_')) return `Remove an item from ${where}`;
  return `Make a change in ${where}`;
}

/**
 * What Rooftap is doing while a step's tools run, for the line under the
 * reply being written: "Checking Groceries and Calendar" for lookups, the
 * change itself (as its proposal card would say) for a change.
 */
export function toolStatus(calls: { tool: string; module: AssistantScope; lookup?: boolean; args: Record<string, unknown> }[]): string | null {
  const change = calls.find((c) => !c.lookup);
  if (change) {
    const more = calls.filter((c) => !c.lookup).length - 1;
    return `${describeProposal(change.tool, change.module, change.args)}${more > 0 ? ` and ${more} more` : ''}`;
  }
  const places = [
    ...new Set(calls.map((c) => (c.module === HOME_ASSISTANT_SCOPE ? 'Home Assistant' : MODULE_NOUN[c.module as ModuleId] ?? 'the app'))),
  ];
  if (places.length === 0) return null;
  const list = places.length === 1 ? places[0] : `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`;
  return `Checking ${list}`;
}

/** The trust options in the order Settings shows them, with their short labels. */
export const TRUST_OPTIONS: { value: TrustLevel; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'ask', label: 'Ask' },
  { value: 'act', label: 'Act' },
];
