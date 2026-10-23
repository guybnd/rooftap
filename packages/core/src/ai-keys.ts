// HOUP-436: whose AI key pays for a household's AI calls.
//
// 1. The household's own key: no cap, nothing charged to the server.
// 2. Else the server's key, when the plan allows it: always with billing off
//    (self-hosted) or for a comped household, and up to a monthly allowance
//    on hosted Plus.
// 3. Else blocked with a stable code, and both apps point the person at
//    Settings > AI keys or Plus.
//
// The assistant has its own spend-based allowance (assistant.ts); this rule
// covers the single-shot AI reads: receipts, recipes, listings and events.

import { assistantAccess, type AssistantAccess } from './modules/assistant/assistant';
import type { EntitlementTier } from './entitlements';

export type AiKeyProvider = 'openai' | 'openrouter' | 'gemini' | 'anthropic';

export const AI_KEY_PROVIDERS: readonly AiKeyProvider[] = ['gemini', 'openai', 'anthropic', 'openrouter'];

export const AI_KEY_PROVIDER_META: Record<AiKeyProvider, { label: string; keyUrl: string }> = {
  gemini: { label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey' },
  openai: { label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openrouter: { label: 'OpenRouter', keyUrl: 'https://openrouter.ai/settings/keys' },
};

export function isAiKeyProvider(value: unknown): value is AiKeyProvider {
  return typeof value === 'string' && (AI_KEY_PROVIDERS as readonly string[]).includes(value);
}

/** Same three levels as the assistant: none (hosted Free), allowance (hosted Plus), unlimited. */
export type AiAccess = AssistantAccess;

export function aiAccess(tier: EntitlementTier, billing: 'on' | 'off'): AiAccess {
  return assistantAccess(tier, billing);
}

/** AI reads per Plus household per month on the server's key. A proposal to tune. */
export const PLUS_AI_READS_PER_MONTH = 300;

export type AiErrorCode = 'ai_requires_plus' | 'ai_allowance_used' | 'ai_not_configured';

export type AiKeyDecision =
  | { source: 'household'; provider: AiKeyProvider }
  | { source: 'server'; provider: AiKeyProvider }
  | { blocked: AiErrorCode };

export interface AiKeyInput {
  /** The provider the server operator picked for this kind of read. */
  preferred: AiKeyProvider;
  /** Providers the household has its own key for. */
  householdKeys: ReadonlySet<AiKeyProvider>;
  /** Whether the server has a key for `preferred`. */
  serverKey: boolean;
  access: AiAccess;
  /** Server-key reads this household has made this month. */
  usedThisMonth: number;
}

/** Whose key to use for one AI read, or why there is none. */
export function decideAiKey(input: AiKeyInput): AiKeyDecision {
  if (input.householdKeys.has(input.preferred)) return { source: 'household', provider: input.preferred };
  const own = AI_KEY_PROVIDERS.find((p) => input.householdKeys.has(p));
  if (own) return { source: 'household', provider: own };
  if (input.access === 'none') return { blocked: 'ai_requires_plus' };
  if (!input.serverKey) return { blocked: 'ai_not_configured' };
  if (input.access === 'allowance' && input.usedThisMonth >= PLUS_AI_READS_PER_MONTH) return { blocked: 'ai_allowance_used' };
  return { source: 'server', provider: input.preferred };
}

/** What to tell the person when an AI read is blocked. No em-dashes: this is UI copy. */
export function aiBlockedMessage(code: AiErrorCode): string {
  switch (code) {
    case 'ai_requires_plus':
      return "Reading this needs AI. Add your household's own AI key in Settings > AI keys, or get Plus.";
    case 'ai_allowance_used':
      return "This month's AI reads on Plus are used up. Add your household's own AI key in Settings > AI keys to keep going.";
    case 'ai_not_configured':
      return "No AI model is set up on this server. Add your household's own AI key in Settings > AI keys.";
  }
}

/** The month a read counts toward, as YYYY-MM in UTC. */
export function aiUsageMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** A pasted key, trimmed, or null when it can't be a key. */
export function cleanAiKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim();
  if (key.length < 20 || key.length > 512 || /\s/.test(key)) return null;
  return key;
}

/** The last four characters, the only part of a stored key anyone sees again. */
export function aiKeyLast4(key: string): string {
  return key.slice(-4);
}

/** What GET /api/ai-keys answers. */
export interface HouseholdAiKeysStatus {
  keys: { provider: AiKeyProvider; last4: string; createdAt: string }[];
  access: AiAccess;
  /** Server-key reads this month, and the allowance (null when unlimited or none). */
  used: number;
  allowance: number | null;
  /** Owners add and remove keys; everyone else sees the status. */
  isOwner: boolean;
  /** False when the server can't store keys (no HOUSEHOLD_KEYS_SECRET). */
  canStore: boolean;
  /**
   * The server's own keys already cover this household with no limit: the
   * person runs the server, or it's self-hosted with an operator managing them. A household key adds
   * nothing then, so the panel only shows keys saved earlier, to remove them.
   * Missing on older servers.
   */
  serverKeysCover?: boolean;
}

/** Whether Settings shows the household AI keys panel at all. */
export function householdAiKeysShown(status: Pick<HouseholdAiKeysStatus, 'keys' | 'serverKeysCover'>): boolean {
  return !status.serverKeysCover || status.keys.length > 0;
}

/** The panel's description, which says who pays. */
export function householdAiKeysDescription(status: Pick<HouseholdAiKeysStatus, 'serverKeysCover'> | null): string {
  return status?.serverKeysCover
    ? "This server's own keys already cover your household. Remove a key here to use them instead."
    : 'Keys your household pays for itself, used for AI reads and the assistant.';
}

/** The one-line summary at the top of Settings > AI keys. */
export function aiKeysUsageLine(status: Pick<HouseholdAiKeysStatus, 'keys' | 'access' | 'used' | 'allowance'>): string {
  if (status.keys.length) return "Your household's key is used first, with no monthly limit.";
  if (status.access === 'unlimited') return "AI reads use this server's key, with no monthly limit.";
  if (status.access === 'allowance') return `${status.used} of ${status.allowance} AI reads on Rooftap's key used this month.`;
  return "Your plan doesn't include AI on Rooftap's key. Add your own key to read receipts, recipes, listings and events.";
}
