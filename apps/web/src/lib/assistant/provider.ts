import {
  AI_CATALOG,
  AI_SETTINGS_KEY,
  allAiModels,
  cleanAiServerSettings,
  householdAiModels,
  customProviderKeyName,
  extraModelPrices,
  isBuiltInProvider,
  offeredAiModels,
  parseModelRef,
  type AiFeature,
  type AiKeyProvider,
  type AiModelChoices,
  type AiModelOption,
  type AiServerSettings,
} from "@homeup/core";
import { resolveServerKey } from "@/lib/admin-config";
import type { LlmConnection } from "./llm";

// HOUP-442: which model the assistant talks to.
//
// The server's AI settings (Settings > AI providers, stored as AI_SETTINGS)
// name a model for chats and one for quick asks, and the models households
// may pick (core ai-providers.ts). A household's pick wins when it is allowed;
// a household's own key (HOUP-436) pays whenever it covers the provider.
//
// With nothing picked, the older environment settings still decide:
// ASSISTANT_PROVIDER picks one of the providers below; unset, the first one
// with a key wins, in the order listed (cheapest defaults first). The
// "compatible" provider is any server that speaks OpenAI's chat API, such as
// Ollama or LM Studio on a self-hosted box: ASSISTANT_BASE_URL (for example
// http://ollama:11434/v1), optional ASSISTANT_API_KEY, and ASSISTANT_MODEL.
// ASSISTANT_MODEL and ASSISTANT_QUICK_MODEL override the default models for
// chats and for quick asks and routines. Every value can live in admin_config
// or the environment (resolveServerKey).

export type AssistantProvider = AiKeyProvider | "compatible" | (string & {});

export const ASSISTANT_PROVIDERS: readonly AssistantProvider[] = ["gemini", "openrouter", "openai", "anthropic", "compatible"];

interface ProviderDef {
  keyName: string;
  wire: LlmConnection["wire"];
  baseURL?: string;
  /** Chat model and quick model when not overridden. */
  models: { chat: string; quick: string };
}

const WIRES: Record<AiKeyProvider, Pick<ProviderDef, "wire" | "baseURL">> = {
  gemini: { wire: "openai", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  openrouter: { wire: "openai", baseURL: "https://openrouter.ai/api/v1" },
  openai: { wire: "openai" },
  anthropic: { wire: "anthropic" },
};

const PROVIDERS: Record<AiKeyProvider, ProviderDef> = Object.fromEntries(
  (Object.keys(WIRES) as AiKeyProvider[]).map((id) => [
    id,
    { ...WIRES[id], keyName: AI_CATALOG[id].keyName, models: { chat: AI_CATALOG[id].defaults.chat, quick: AI_CATALOG[id].defaults.quick } },
  ])
) as Record<AiKeyProvider, ProviderDef>;

/** How to reach a built-in provider with a key. */
export function builtInConnection(provider: AiKeyProvider, apiKey: string): LlmConnection {
  const def = WIRES[provider];
  return { wire: def.wire, apiKey, ...(def.baseURL ? { baseURL: def.baseURL } : {}) };
}

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
  /** Prices the operator gave for models they added (AI_SETTINGS). */
  extraPrices?: Record<string, { input: number; output: number }>;
  /** Quick asks run here when the quick model is on another provider or key. */
  quickBrain?: AssistantBrain;
}

type Lookup = (key: string) => Promise<string | undefined>;

/** Every setting resolveServerBrain may read, so a caller can fetch them in one go (resolveServerKeys). */
export const SERVER_BRAIN_KEYS: readonly string[] = [
  AI_SETTINGS_KEY,
  "ASSISTANT_PROVIDER",
  "ASSISTANT_MODEL",
  "ASSISTANT_QUICK_MODEL",
  "ASSISTANT_BASE_URL",
  "ASSISTANT_API_KEY",
  "ASSISTANT_STREAM",
  ...Object.values(PROVIDERS).map((p) => p.keyName),
];

export async function usable(lookup: Lookup, key: string): Promise<string | undefined> {
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
        connection: {
          wire: "openai",
          baseURL,
          apiKey: (await usable(lookup, "ASSISTANT_API_KEY")) ?? "",
          // A server that can't stream is found out on its own; this skips even trying.
          ...(/^(off|false|0|no)$/i.test((await usable(lookup, "ASSISTANT_STREAM")) ?? "") ? { stream: false } : {}),
        },
        chatModel: chatOverride,
        quickModel: quickOverride ?? chatOverride,
        free: true,
        keySource: "server",
      };
    }
    const def = PROVIDERS[provider as AiKeyProvider];
    const apiKey = await usable(lookup, def.keyName);
    if (!apiKey) continue;
    return {
      provider,
      connection: builtInConnection(provider as AiKeyProvider, apiKey),
      chatModel: chatOverride ?? def.models.chat,
      quickModel: quickOverride ?? def.models.quick,
      free: false,
      keySource: "server",
    };
  }
  return null;
}

const BUILT_IN_ORDER = ASSISTANT_PROVIDERS.filter((p): p is AiKeyProvider => isBuiltInProvider(p));

/**
 * A second provider for when the first is busy (a 503 from an overloaded
 * model): the next provider in order that has a server key, on its default
 * models. None when the operator pinned ASSISTANT_PROVIDER or only one is set.
 */
export async function resolveBackupBrain(primary: AssistantBrain, lookup: Lookup = resolveServerKey): Promise<AssistantBrain | null> {
  if (primary.keySource !== "server" || !isBuiltInProvider(primary.provider)) return null;
  if (await usable(lookup, "ASSISTANT_PROVIDER")) return null;
  for (const provider of BUILT_IN_ORDER) {
    if (provider === primary.provider) continue;
    const def = PROVIDERS[provider];
    const apiKey = await usable(lookup, def.keyName);
    if (!apiKey) continue;
    return {
      provider,
      connection: builtInConnection(provider, apiKey),
      chatModel: def.models.chat,
      quickModel: def.models.quick,
      free: false,
      keySource: "server",
    };
  }
  return null;
}

/** The household's own brain (HOUP-436): its first key in provider order, on that provider's default models. */
export function resolveHouseholdBrain(keys: ReadonlyMap<string, string>): AssistantBrain | null {
  for (const provider of BUILT_IN_ORDER) {
    const apiKey = keys.get(provider);
    if (!apiKey) continue;
    const def = PROVIDERS[provider];
    return {
      provider,
      connection: builtInConnection(provider, apiKey),
      chatModel: def.models.chat,
      quickModel: def.models.quick,
      free: false,
      keySource: "household",
    };
  }
  return null;
}

/** Built-in providers the server has a usable key for. */
export async function serverKeyedProviders(lookup: Lookup): Promise<Set<AiKeyProvider>> {
  const keyed = await Promise.all(BUILT_IN_ORDER.map(async (p) => ((await usable(lookup, PROVIDERS[p].keyName)) ? p : null)));
  return new Set(keyed.filter((p): p is AiKeyProvider => p !== null));
}

export interface BrainInput {
  /** The server's settings, usually a resolveServerKeys lookup over SERVER_BRAIN_KEYS. */
  lookup: Lookup;
  /** For custom providers' keys, which aren't known until the settings are read. */
  lookupOne?: Lookup;
  /** The household's own keys, by provider. */
  householdKeys: ReadonlyMap<string, string>;
  /** The household's picks (assistant_settings.chat_model / quick_model): model refs, or older bare model names. */
  choice?: { chat: string | null; quick: string | null };
}

interface Side {
  provider: AssistantProvider;
  connection: LlmConnection;
  model: string;
  free: boolean;
  keySource: "household" | "server";
}

function toBrain(side: Side, quickModel: string, extraPrices: AssistantBrain["extraPrices"]): AssistantBrain {
  return { provider: side.provider, connection: side.connection, chatModel: side.model, quickModel, free: side.free, keySource: side.keySource, extraPrices };
}

/**
 * The assistant's brain for one household, by job:
 *
 * 1. The household's pick, when it is still allowed (offered by the operator,
 *    or on a provider the household has its own key for).
 * 2. With the household's own key and no pick: the operator's model when it
 *    is on that provider, else the provider's default model, on their key.
 * 3. The operator's model for the job, on the server's key.
 * 4. The older environment settings (resolveServerBrain).
 *
 * An older bare model name in the household's pick still overrides the model
 * on whichever provider steps 2 to 4 land on, as it did before.
 */
export async function resolveAssistantBrain(input: BrainInput): Promise<AssistantBrain | null> {
  const { lookup, householdKeys } = input;
  const lookupOne = input.lookupOne ?? resolveServerKey;
  const settings: AiServerSettings = cleanAiServerSettings(await lookup(AI_SETTINGS_KEY));
  const serverKeyed = await serverKeyedProviders(lookup);
  const offered = new Set(offeredAiModels(settings, serverKeyed).map((m) => m.ref));
  const extraPrices = extraModelPrices(settings);
  const legacy = { brain: undefined as AssistantBrain | null | undefined };

  const connect = async (ref: string, preferHousehold: boolean): Promise<Side | null> => {
    const parsed = parseModelRef(ref);
    if (!parsed) return null;
    const { provider, model } = parsed;
    if (isBuiltInProvider(provider)) {
      const own = preferHousehold ? householdKeys.get(provider) : undefined;
      if (own) return { provider, connection: builtInConnection(provider, own), model, free: false, keySource: "household" };
      const apiKey = await usable(lookup, PROVIDERS[provider].keyName);
      return apiKey ? { provider, connection: builtInConnection(provider, apiKey), model, free: false, keySource: "server" } : null;
    }
    const custom = settings.custom.find((c) => c.id === provider);
    if (!custom) return null;
    const apiKey = (await usable(lookupOne, customProviderKeyName(custom.id))) ?? "";
    return { provider, connection: { wire: "openai", baseURL: custom.baseURL, apiKey, ...(custom.stream === false ? { stream: false } : {}) }, model, free: true, keySource: "server" };
  };

  const side = async (feature: Exclude<AiFeature, "reads">): Promise<Side | null> => {
    let pick = input.choice?.[feature] ?? null;
    // An older bare model name that matches a listed model counts as picking it.
    if (pick && !parseModelRef(pick)) {
      const match = allAiModels(settings).find((m) => m.model === pick && (householdKeys.has(m.provider) || offered.has(m.ref)));
      if (match) pick = match.ref;
    }
    const pickRef = parseModelRef(pick);
    if (pickRef && (householdKeys.has(pickRef.provider) || offered.has(pick!))) {
      const s = await connect(pick!, true);
      if (s) return s;
    }
    const bare = pick && !pickRef ? pick : null;
    const operator = settings.defaults[feature];
    const operatorRef = parseModelRef(operator);

    const ownBrain = resolveHouseholdBrain(householdKeys);
    if (ownBrain) {
      if (operatorRef && householdKeys.has(operatorRef.provider)) {
        const s = await connect(operator!, true);
        if (s) return bare ? { ...s, model: bare } : s;
      }
      return { provider: ownBrain.provider, connection: ownBrain.connection, model: bare ?? ownBrain[feature === "chat" ? "chatModel" : "quickModel"], free: false, keySource: "household" };
    }
    if (operator) {
      const s = await connect(operator, false);
      if (s) return bare ? { ...s, model: bare } : s;
    }
    if (legacy.brain === undefined) legacy.brain = await resolveServerBrain(lookup);
    if (!legacy.brain) return null;
    const b = legacy.brain;
    return { provider: b.provider, connection: b.connection, model: bare ?? (feature === "chat" ? b.chatModel : b.quickModel), free: b.free, keySource: b.keySource };
  };

  const chat = await side("chat");
  if (!chat) return null;
  const quick = (await side("quick")) ?? chat;
  const sameConnection =
    quick.provider === chat.provider &&
    quick.keySource === chat.keySource &&
    quick.connection.baseURL === chat.connection.baseURL &&
    quick.connection.apiKey === chat.connection.apiKey;
  const brain = toBrain(chat, sameConnection ? quick.model : chat.model, extraPrices);
  if (!sameConnection) brain.quickBrain = toBrain(quick, quick.model, extraPrices);
  return brain;
}

function optionFor(settings: AiServerSettings, provider: string, model: string): AiModelOption {
  const ref = `${provider}:${model}`;
  return (
    allAiModels(settings).find((m) => m.ref === ref) ?? {
      ref,
      provider,
      providerLabel: isBuiltInProvider(provider) ? AI_CATALOG[provider].label : settings.custom.find((c) => c.id === provider)?.label ?? "This server",
      model,
      label: model,
      input: null,
      output: null,
      verified: false,
      reads: false,
    }
  );
}

/** The models a household may pick in Settings > Assistant, and what "Server default" means today. */
export async function assistantModelChoices(lookup: Lookup, householdKeys: ReadonlyMap<string, string>, lookupOne?: Lookup): Promise<AiModelChoices> {
  const settings = cleanAiServerSettings(await lookup(AI_SETTINGS_KEY));
  const serverKeyed = await serverKeyedProviders(lookup);
  const own = new Set(householdKeys.keys());
  const brain = await resolveAssistantBrain({ lookup, lookupOne, householdKeys });
  const quick = brain?.quickBrain ?? brain;
  return {
    chat: householdAiModels(settings, serverKeyed, own, "chat"),
    quick: householdAiModels(settings, serverKeyed, own, "quick"),
    defaults: {
      chat: brain ? optionFor(settings, brain.provider, brain.chatModel) : null,
      quick: quick ? optionFor(settings, quick.provider, quick.quickModel) : null,
    },
  };
}

/** Whether a household may save this pick: null, or a ref among its choices. */
export function isAllowedModelPick(pick: string | null, choices: readonly AiModelOption[]): boolean {
  return pick === null || choices.some((m) => m.ref === pick);
}
