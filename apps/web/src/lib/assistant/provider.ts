import { resolveServerKey } from "@/lib/admin-config";
import type { LlmConnection } from "./llm";

// HOUP-442: which model the assistant talks to on the server's key.
//
// ASSISTANT_PROVIDER picks one of the providers below; unset, the first one
// with a key wins, in the order listed (cheapest defaults first). The
// "compatible" provider is any server that speaks OpenAI's chat API, such as
// Ollama or LM Studio on a self-hosted box: ASSISTANT_BASE_URL (for example
// http://ollama:11434/v1), optional ASSISTANT_API_KEY, and ASSISTANT_MODEL.
// ASSISTANT_MODEL and ASSISTANT_QUICK_MODEL override the default models for
// chats and for quick asks and routines. Every value can live in admin_config
// or the environment (resolveServerKey). A household's own key (HOUP-436)
// comes first: resolveHouseholdBrain.

export type AssistantProvider = "gemini" | "openrouter" | "openai" | "anthropic" | "compatible";

export const ASSISTANT_PROVIDERS: readonly AssistantProvider[] = ["gemini", "openrouter", "openai", "anthropic", "compatible"];

interface ProviderDef {
  keyName: string;
  wire: LlmConnection["wire"];
  baseURL?: string;
  /** Chat model and quick model when not overridden. */
  models: { chat: string; quick: string };
  /** Local servers cost nothing unless an operator prices them. */
  free?: boolean;
}

const PROVIDERS: Record<Exclude<AssistantProvider, "compatible">, ProviderDef> = {
  gemini: {
    keyName: "GEMINI_API_KEY",
    wire: "openai",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    models: { chat: "gemini-2.5-flash", quick: "gemini-2.5-flash-lite" },
  },
  openrouter: {
    keyName: "OPENROUTER_API_KEY",
    wire: "openai",
    baseURL: "https://openrouter.ai/api/v1",
    models: { chat: "google/gemini-2.5-flash", quick: "google/gemini-2.5-flash-lite" },
  },
  openai: { keyName: "OPENAI_API_KEY", wire: "openai", models: { chat: "gpt-4o-mini", quick: "gpt-4o-mini" } },
  anthropic: {
    keyName: "ANTHROPIC_API_KEY",
    wire: "anthropic",
    models: { chat: "claude-haiku-4-5-20251001", quick: "claude-haiku-4-5-20251001" },
  },
};

// Same placeholders as .env.example, so an untouched copy counts as unset.
const PLACEHOLDERS = new Set(["your-openai-key", "your-openrouter-key", "your-gemini-key", "your-anthropic-key"]);

export interface AssistantBrain {
  provider: AssistantProvider;
  connection: LlmConnection;
  chatModel: string;
  quickModel: string;
  /** True for a local server: its turns cost nothing unless priced in ASSISTANT_MODEL_PRICES. */
  free: boolean;
  /** Whose key pays (assistant_usage.key_source). */
  keySource: "household" | "server";
}

type Lookup = (key: string) => Promise<string | undefined>;

async function usable(lookup: Lookup, key: string): Promise<string | undefined> {
  const value = (await lookup(key))?.trim();
  return value && !PLACEHOLDERS.has(value) ? value : undefined;
}

/** The server's assistant brain, or null when no provider is configured. */
export async function resolveServerBrain(lookup: Lookup = resolveServerKey): Promise<AssistantBrain | null> {
  const chosen = (await usable(lookup, "ASSISTANT_PROVIDER"))?.toLowerCase();
  const order: AssistantProvider[] =
    chosen && (ASSISTANT_PROVIDERS as readonly string[]).includes(chosen) ? [chosen as AssistantProvider] : [...ASSISTANT_PROVIDERS];
  const chatOverride = await usable(lookup, "ASSISTANT_MODEL");
  const quickOverride = await usable(lookup, "ASSISTANT_QUICK_MODEL");

  for (const provider of order) {
    if (provider === "compatible") {
      const baseURL = await usable(lookup, "ASSISTANT_BASE_URL");
      if (!baseURL || !chatOverride) continue;
      return {
        provider,
        connection: { wire: "openai", baseURL, apiKey: (await usable(lookup, "ASSISTANT_API_KEY")) ?? "" },
        chatModel: chatOverride,
        quickModel: quickOverride ?? chatOverride,
        free: true,
        keySource: "server",
      };
    }
    const def = PROVIDERS[provider];
    const apiKey = await usable(lookup, def.keyName);
    if (!apiKey) continue;
    return {
      provider,
      connection: { wire: def.wire, apiKey, ...(def.baseURL ? { baseURL: def.baseURL } : {}) },
      chatModel: chatOverride ?? def.models.chat,
      quickModel: quickOverride ?? def.models.quick,
      free: false,
      keySource: "server",
    };
  }
  return null;
}

/** The household's own brain (HOUP-436): its first key in provider order, on that provider's default models. */
export function resolveHouseholdBrain(keys: ReadonlyMap<string, string>): AssistantBrain | null {
  for (const provider of ASSISTANT_PROVIDERS) {
    if (provider === "compatible") continue;
    const apiKey = keys.get(provider);
    if (!apiKey) continue;
    const def = PROVIDERS[provider];
    return {
      provider,
      connection: { wire: def.wire, apiKey, ...(def.baseURL ? { baseURL: def.baseURL } : {}) },
      chatModel: def.models.chat,
      quickModel: def.models.quick,
      free: false,
      keySource: "household",
    };
  }
  return null;
}
