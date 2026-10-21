// One place for the AI providers and models Rooftap can talk to, shared by
// the server (which picks a model for each job) and both apps (which show
// the pickers).
//
// - The built-in providers (Google Gemini, OpenAI, Anthropic, OpenRouter) come
//   with a list of verified models: ones tested against Rooftap's clients,
//   with list prices so budgets can count spend.
// - A server operator can add custom providers (any server that speaks
//   OpenAI's chat API, such as Ollama, LM Studio or a company gateway) and
//   extra models on any provider. Those are unverified: Rooftap can't vouch
//   for their tool calling or price.
// - The operator picks a default model for each job (assistant chats, quick
//   asks, AI reads) and which models households may choose from. A household
//   with its own key for a provider may also pick any of that provider's
//   verified models (its key, its bill).
//
// A model is named by a ref, `<provider>:<model id>`, such as
// `anthropic:claude-haiku-5-5` or `openrouter:google/gemini-3.1-flash-lite`.
// The settings live in the server's admin_config as JSON (AI_SETTINGS), so
// no table is needed.

import type { AiKeyProvider } from './ai-keys';
import type { PickerOption } from './types';

export type AiFeature = 'chat' | 'quick' | 'reads';

export const AI_FEATURES: readonly { id: AiFeature; label: string; hint: string }[] = [
  { id: 'chat', label: 'Assistant chats', hint: 'Named chats and the household thread.' },
  { id: 'quick', label: 'Quick asks', hint: 'Quick asks, routines and anything over budget. A cheaper model fits.' },
  { id: 'reads', label: 'AI reads', hint: 'Reading receipts, recipes, listings and events from photos and links.' },
];

export interface AiCatalogModel {
  id: string;
  label: string;
  /** List price in US dollars per million tokens. */
  input: number;
  output: number;
  /** Can do AI reads: structured output from text and photos with this provider's read client. */
  reads: boolean;
  note?: string;
}

export interface AiBuiltInProvider {
  id: AiKeyProvider;
  label: string;
  /** Where the server's key lives (admin_config or the environment). */
  keyName: string;
  keyUrl: string;
  models: readonly AiCatalogModel[];
  /** Used when nothing else is picked, for each job. */
  defaults: Record<AiFeature, string>;
}

/**
 * Verified models. Prices are list prices as of October 2026; an operator
 * can correct one with ASSISTANT_MODEL_PRICES. Anthropic's 5.5 Sonnet and
 * Opus are left out on purpose: they can't turn thinking off, and Rooftap's
 * client doesn't replay thinking between tool calls yet.
 */
export const AI_CATALOG: Record<AiKeyProvider, AiBuiltInProvider> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    keyName: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', input: 0.25, output: 1.5, reads: true },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', input: 0.3, output: 2.5, reads: true },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', input: 0.75, output: 3.75, reads: true, note: 'Introductory price until the end of 2026' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', input: 0.3, output: 2.5, reads: true },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', input: 0.1, output: 0.4, reads: true },
    ],
    defaults: { chat: 'gemini-3.1-flash-lite', quick: 'gemini-3.1-flash-lite', reads: 'gemini-3.1-flash-lite' },
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyName: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', input: 0.15, output: 0.6, reads: true },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', input: 0.2, output: 1.25, reads: true },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', input: 0.75, output: 4.5, reads: true },
    ],
    defaults: { chat: 'gpt-4o-mini', quick: 'gpt-4o-mini', reads: 'gpt-4o-mini' },
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    keyName: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', input: 0.1, output: 0.5, reads: true },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', input: 1, output: 5, reads: true },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', input: 3, output: 15, reads: true },
    ],
    defaults: { chat: 'claude-haiku-5-5', quick: 'claude-haiku-5-5', reads: 'claude-haiku-5-5' },
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyName: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/settings/keys',
    models: [
      { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', input: 0.25, output: 1.5, reads: true },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', input: 0.15, output: 0.6, reads: true },
    ],
    defaults: { chat: 'google/gemini-3.1-flash-lite', quick: 'google/gemini-3.1-flash-lite', reads: 'openai/gpt-4o-mini' },
  },
};

/** Built-in providers in the order the server tries them when nothing is picked (cheapest defaults first). */
export const AI_PROVIDER_ORDER: readonly AiKeyProvider[] = ['gemini', 'openrouter', 'openai', 'anthropic'];

export function isBuiltInProvider(id: string): id is AiKeyProvider {
  return Object.prototype.hasOwnProperty.call(AI_CATALOG, id);
}

/** A server that speaks OpenAI's chat API, added by the operator. Its key, if any, is stored apart. */
export interface AiCustomProvider {
  id: string;
  label: string;
  baseURL: string;
}

/** A model the operator added by hand, on a built-in or custom provider. */
export interface AiExtraModel {
  provider: string;
  id: string;
  label?: string;
  /** US dollars per million tokens, when the operator knows them. */
  input?: number;
  output?: number;
}

export interface AiServerSettings {
  custom: AiCustomProvider[];
  extraModels: AiExtraModel[];
  /** Model refs households may pick. null: every model the server has a key for. */
  offered: string[] | null;
  /** The server's model for each job; unset falls back to the first provider with a key. */
  defaults: Partial<Record<AiFeature, string>>;
}

export const EMPTY_AI_SERVER_SETTINGS: AiServerSettings = { custom: [], extraModels: [], offered: null, defaults: {} };

/** admin_config key holding AiServerSettings as JSON. */
export const AI_SETTINGS_KEY = 'AI_SETTINGS';

const PROVIDER_ID = /^[a-z][a-z0-9-]{0,31}$/;

export function modelRef(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/** Splits a ref at its first colon. Null for anything that isn't one (such as an older bare model name). */
export function parseModelRef(ref: string | null | undefined): { provider: string; model: string } | null {
  if (!ref) return null;
  const at = ref.indexOf(':');
  if (at <= 0) return null;
  const provider = ref.slice(0, at);
  const model = ref.slice(at + 1).trim();
  if (!PROVIDER_ID.test(provider) || !model) return null;
  return { provider, model };
}

/** Where a custom provider's key is stored in admin_config. */
export function customProviderKeyName(id: string): string {
  return `AI_KEY_${id.toUpperCase().replace(/-/g, '_')}`;
}

/** Turns a name like "Home Ollama" into a provider id that can't clash with a built-in one. */
export function customProviderId(label: string, taken: readonly string[] = []): string {
  const base = `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'server'}`;
  let id = base;
  for (let n = 2; taken.includes(id) || isBuiltInProvider(id); n++) id = `${base}-${n}`;
  return id;
}

function finite(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}

function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s]+$/i.test(url) && url.length <= 300 ? url : null;
}

/**
 * Settings from stored JSON or a request body, keeping only what is valid:
 * a broken entry is dropped rather than failing the whole server.
 */
export function cleanAiServerSettings(raw: unknown): AiServerSettings {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ...EMPTY_AI_SERVER_SETTINGS };
    }
  }
  if (!value || typeof value !== 'object') return { ...EMPTY_AI_SERVER_SETTINGS };
  const v = value as Record<string, unknown>;

  const custom: AiCustomProvider[] = [];
  for (const c of Array.isArray(v.custom) ? v.custom.slice(0, 20) : []) {
    const o = (c ?? {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const label = typeof o.label === 'string' ? o.label.trim().slice(0, 40) : '';
    const baseURL = cleanUrl(o.baseURL);
    if (!PROVIDER_ID.test(id) || isBuiltInProvider(id) || !label || !baseURL || custom.some((x) => x.id === id)) continue;
    custom.push({ id, label, baseURL });
  }
  const providers = new Set<string>([...Object.keys(AI_CATALOG), ...custom.map((c) => c.id)]);

  const extraModels: AiExtraModel[] = [];
  for (const m of Array.isArray(v.extraModels) ? v.extraModels.slice(0, 100) : []) {
    const o = (m ?? {}) as Record<string, unknown>;
    const provider = typeof o.provider === 'string' ? o.provider : '';
    const id = typeof o.id === 'string' ? o.id.trim().slice(0, 120) : '';
    if (!providers.has(provider) || !id || /\s/.test(id)) continue;
    if (extraModels.some((x) => x.provider === provider && x.id === id)) continue;
    if (isBuiltInProvider(provider) && AI_CATALOG[provider].models.some((x) => x.id === id)) continue;
    const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 60) : undefined;
    const input = finite(o.input);
    const output = finite(o.output);
    extraModels.push({ provider, id, ...(label ? { label } : {}), ...(input !== undefined && output !== undefined ? { input, output } : {}) });
  }

  const known = (ref: unknown): ref is string => {
    const p = typeof ref === 'string' ? parseModelRef(ref) : null;
    return !!p && providers.has(p.provider);
  };
  const offered = Array.isArray(v.offered) ? [...new Set(v.offered.filter(known))].slice(0, 200) : null;
  const defaults: Partial<Record<AiFeature, string>> = {};
  const d = (v.defaults ?? {}) as Record<string, unknown>;
  for (const f of AI_FEATURES) if (known(d[f.id])) defaults[f.id] = d[f.id] as string;

  return { custom, extraModels, offered, defaults };
}

/** One model as the pickers show it. */
export interface AiModelOption {
  ref: string;
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  /** US dollars per million tokens; null when unknown. */
  input: number | null;
  output: number | null;
  /** In Rooftap's verified list. */
  verified: boolean;
  /** Fit for AI reads (verified built-in models that can do structured reads). */
  reads: boolean;
}

/** Every model on every provider the settings know, keyed or not, in provider order. */
export function allAiModels(settings: AiServerSettings): AiModelOption[] {
  const out: AiModelOption[] = [];
  const providerLabel = (id: string) =>
    isBuiltInProvider(id) ? AI_CATALOG[id].label : settings.custom.find((c) => c.id === id)?.label ?? id;
  for (const id of AI_PROVIDER_ORDER) {
    for (const m of AI_CATALOG[id].models) {
      out.push({ ref: modelRef(id, m.id), provider: id, providerLabel: providerLabel(id), model: m.id, label: m.label, input: m.input, output: m.output, verified: true, reads: m.reads });
    }
  }
  const providers = [...AI_PROVIDER_ORDER, ...settings.custom.map((c) => c.id)];
  for (const id of providers) {
    for (const m of settings.extraModels.filter((x) => x.provider === id)) {
      out.push({
        ref: modelRef(id, m.id),
        provider: id,
        providerLabel: providerLabel(id),
        model: m.id,
        label: m.label ?? m.id,
        input: m.input ?? null,
        output: m.output ?? null,
        verified: false,
        reads: false,
      });
    }
  }
  return out;
}

/** The models fit for a job: AI reads need a read-capable model, the assistant takes any. */
export function modelsForFeature(models: readonly AiModelOption[], feature: AiFeature): AiModelOption[] {
  return feature === 'reads' ? models.filter((m) => m.reads) : [...models];
}

/**
 * What the server itself can use: models on providers it has a key for.
 * Custom providers count as ready, since a local server often needs no key.
 */
export function serverAiModels(settings: AiServerSettings, serverKeyed: ReadonlySet<string>): AiModelOption[] {
  const custom = new Set(settings.custom.map((c) => c.id));
  return allAiModels(settings).filter((m) => serverKeyed.has(m.provider) || custom.has(m.provider));
}

/** The models the operator lets households pick on the server's keys. */
export function offeredAiModels(settings: AiServerSettings, serverKeyed: ReadonlySet<string>): AiModelOption[] {
  const ready = serverAiModels(settings, serverKeyed);
  if (!settings.offered) return ready;
  const offered = new Set(settings.offered);
  return ready.filter((m) => offered.has(m.ref));
}

/**
 * The models a household may pick for a job: what the operator offers, plus
 * every verified model on a provider the household has its own key for.
 */
export function householdAiModels(
  settings: AiServerSettings,
  serverKeyed: ReadonlySet<string>,
  householdKeyed: ReadonlySet<string>,
  feature: AiFeature
): AiModelOption[] {
  const own = allAiModels(settings).filter((m) => m.verified && householdKeyed.has(m.provider));
  const seen = new Set(own.map((m) => m.ref));
  const offered = offeredAiModels(settings, serverKeyed).filter((m) => !seen.has(m.ref));
  const order = allAiModels(settings).map((m) => m.ref);
  return modelsForFeature([...own, ...offered], feature).sort((a, b) => order.indexOf(a.ref) - order.indexOf(b.ref));
}

/** The list price of every verified model, by bare model id (what usage rows record). */
export function catalogModelPrices(): Record<string, { input: number; output: number }> {
  const out: Record<string, { input: number; output: number }> = {};
  for (const p of Object.values(AI_CATALOG)) for (const m of p.models) out[m.id] = { input: m.input, output: m.output };
  return out;
}

/** Prices the operator gave for models they added. */
export function extraModelPrices(settings: AiServerSettings): Record<string, { input: number; output: number }> {
  const out: Record<string, { input: number; output: number }> = {};
  for (const m of settings.extraModels) if (m.input !== undefined && m.output !== undefined) out[m.id] = { input: m.input, output: m.output };
  return out;
}

/** "$0.10 in, $0.50 out per million tokens", or a note when unknown. No em-dashes: UI copy. */
export function aiModelPriceLine(m: Pick<AiModelOption, 'input' | 'output' | 'verified'>): string {
  if (m.input === null || m.output === null) return m.verified ? 'Price unknown' : 'Added by the server, price unknown';
  const fmt = (n: number) => `$${n < 1 ? n.toFixed(2) : n % 1 ? n.toFixed(2) : n.toFixed(0)}`;
  return `${fmt(m.input)} in, ${fmt(m.output)} out per million tokens`;
}

/** Picker rows grouped by provider, with "Server default" first when `defaultLabel` is given. */
export function aiModelPickerOptions(models: readonly AiModelOption[], defaultLabel?: string): PickerOption[] {
  const rows: PickerOption[] = models.map((m) => ({
    value: m.ref,
    primary: m.label,
    secondary: aiModelPriceLine(m),
    group: { key: m.provider, label: m.providerLabel },
    searchText: `${m.model} ${m.providerLabel}`,
  }));
  return defaultLabel ? [{ value: '', primary: defaultLabel, secondary: null }, ...rows] : rows;
}

/** What GET /api/admin/ai-providers answers (server operators only). */
export interface AiProvidersStatus {
  settings: AiServerSettings;
  providers: { id: string; label: string; builtIn: boolean; keyName: string; keyUrl: string | null; baseURL: string | null; isSet: boolean }[];
  models: AiModelOption[];
}

/** The household's model choices, in GET /api/assistant/settings. */
export interface AiModelChoices {
  chat: AiModelOption[];
  quick: AiModelOption[];
  /** What "Server default" means right now, by job. */
  defaults: { chat: AiModelOption | null; quick: AiModelOption | null };
}

// ── Editing (both apps' operator panels) ──────────────────────────────────

/** Turns "Households can pick any model" on (null) or off (everything that is ready now, so nothing vanishes). */
export function withOfferedAll(settings: AiServerSettings, all: boolean, ready: readonly AiModelOption[]): AiServerSettings {
  return { ...settings, offered: all ? null : ready.map((m) => m.ref) };
}

export function withOfferedToggled(settings: AiServerSettings, ref: string): AiServerSettings {
  const offered = settings.offered ?? [];
  return { ...settings, offered: offered.includes(ref) ? offered.filter((r) => r !== ref) : [...offered, ref] };
}

/** '' clears the job back to automatic. */
export function withDefault(settings: AiServerSettings, feature: AiFeature, ref: string): AiServerSettings {
  const defaults = { ...settings.defaults };
  if (ref) defaults[feature] = ref;
  else delete defaults[feature];
  return { ...settings, defaults };
}

/** Splits "a, b c" into model ids. */
export function splitModelIds(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

/** Adds a custom provider with its models, offered to households when the list is restricted. */
export function withCustomProvider(settings: AiServerSettings, label: string, baseURL: string, modelIds: readonly string[]): AiServerSettings {
  const id = customProviderId(label, settings.custom.map((c) => c.id));
  const models = modelIds.map((m) => ({ provider: id, id: m }));
  return {
    ...settings,
    custom: [...settings.custom, { id, label: label.trim(), baseURL: baseURL.trim() }],
    extraModels: [...settings.extraModels, ...models],
    offered: settings.offered ? [...settings.offered, ...models.map((m) => modelRef(id, m.id))] : null,
  };
}

/** Removes a custom provider, its models, and any pick that named them. */
export function withoutCustomProvider(settings: AiServerSettings, id: string): AiServerSettings {
  const keep = (ref: string | undefined) => parseModelRef(ref)?.provider !== id;
  return {
    custom: settings.custom.filter((c) => c.id !== id),
    extraModels: settings.extraModels.filter((m) => m.provider !== id),
    offered: settings.offered ? settings.offered.filter(keep) : null,
    defaults: Object.fromEntries(Object.entries(settings.defaults).filter(([, ref]) => keep(ref))),
  };
}

export function withExtraModel(settings: AiServerSettings, provider: string, id: string): AiServerSettings {
  const ref = modelRef(provider, id);
  if (allAiModels(settings).some((m) => m.ref === ref)) return settings;
  return {
    ...settings,
    extraModels: [...settings.extraModels, { provider, id }],
    offered: settings.offered ? [...settings.offered, ref] : null,
  };
}

export function withoutExtraModel(settings: AiServerSettings, ref: string): AiServerSettings {
  return {
    ...settings,
    extraModels: settings.extraModels.filter((m) => modelRef(m.provider, m.id) !== ref),
    offered: settings.offered ? settings.offered.filter((r) => r !== ref) : null,
    defaults: Object.fromEntries(Object.entries(settings.defaults).filter(([, r]) => r !== ref)),
  };
}

/**
 * A household's saved pick as the picker shows it: an older bare model name
 * shows as the matching model. Returns the value and, when the pick isn't
 * among the choices, an extra row explaining why. No em-dashes: UI copy.
 */
export function shownModelPick(pick: string | null, choices: readonly AiModelOption[]): { value: string; extra: PickerOption | null } {
  if (!pick) return { value: '', extra: null };
  const value = choices.find((m) => m.ref === pick || m.model === pick)?.ref ?? pick;
  if (choices.some((m) => m.ref === value)) return { value, extra: null };
  const note = parseModelRef(pick) ? 'No longer offered here, so the server default is used' : 'Set by name earlier';
  return { value, extra: { value, primary: pick, secondary: note } };
}
