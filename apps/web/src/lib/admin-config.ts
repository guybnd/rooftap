import { AI_CATALOG, AI_SETTINGS_KEY, cleanAiServerSettings, isBuiltInProvider, parseModelRef, type AiServerSettings } from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";

// HOUP-25: owner-editable third-party API keys, stored server-side in the
// service-role-only `admin_config` table (zero client RLS — mirrors
// personal_access_tokens). resolveServerKey() is the read path every
// consumer should use: it prefers the stored value and falls back to
// process.env, so an empty table reproduces today's behavior exactly.

export async function getAdminConfigValue(key: string): Promise<string | undefined> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("admin_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value ?? undefined;
}

// Throws when the write fails, so a caller never reports a key as saved that
// the database refused (a missing table, a bad service-role key).
export async function setAdminConfigValue(key: string, value: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("admin_config")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

/**
 * resolveServerKey for several keys in one query, as a lookup. For callers
 * that would otherwise read admin_config once per key in a row (each a round
 * trip to the database).
 */
export async function resolveServerKeys(keys: readonly string[]): Promise<(key: string) => Promise<string | undefined>> {
  const admin = createAdminClient();
  const { data } = await admin.from("admin_config").select("key, value").in("key", [...keys]);
  const stored = new Map(((data ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value ?? undefined]));
  return async (key) => stored.get(key) ?? process.env[key];
}

export async function resolveServerKey(key: string): Promise<string | undefined> {
  const stored = await getAdminConfigValue(key);
  return stored ?? process.env[key];
}

// HOUP-43: which provider handles a given parse type. `AI_PARSING_PROVIDER`
// is a single owner-facing setting that applies to all parse types — when
// unset (or an unrecognized value), each type falls back to its historical
// provider so an untouched install behaves exactly as it did before this
// setting existed.
export type ParsingType = "listing" | "receipt" | "recipe" | "event";
export type ParsingProvider = "openai" | "openrouter" | "gemini" | "anthropic";

const KNOWN_PROVIDERS = new Set<string>(["openai", "openrouter", "gemini", "anthropic"]);

const LEGACY_PROVIDER: Record<ParsingType, ParsingProvider> = {
  listing: "openai",
  receipt: "openai",
  recipe: "gemini",
  event: "gemini",
};

/** The server's AI settings (Settings > AI providers); empty when never saved. */
export async function loadAiServerSettings(): Promise<AiServerSettings> {
  return cleanAiServerSettings(await getAdminConfigValue(AI_SETTINGS_KEY));
}

/** The operator's model for AI reads, when it is a built-in one that can do them. */
export function readsModelRef(settings: AiServerSettings): { provider: ParsingProvider; model: string } | null {
  const ref = parseModelRef(settings.defaults.reads);
  if (!ref || !isBuiltInProvider(ref.provider)) return null;
  const model = AI_CATALOG[ref.provider].models.find((m) => m.id === ref.model);
  return model?.reads ? { provider: ref.provider, model: model.id } : null;
}

/** Which model an AI read on this provider uses: the operator's pick when it is on that provider, else the provider's default. */
export async function resolveReadsModel(provider: ParsingProvider, settings?: AiServerSettings): Promise<string> {
  const picked = readsModelRef(settings ?? (await loadAiServerSettings()));
  return picked?.provider === provider ? picked.model : AI_CATALOG[provider].defaults.reads;
}

export async function resolveParsingProvider(type: ParsingType, settings?: AiServerSettings): Promise<ParsingProvider> {
  // The AI providers panel's pick for AI reads wins over the older single switch.
  const picked = readsModelRef(settings ?? (await loadAiServerSettings()));
  if (picked) return picked.provider;
  const configured = await getAdminConfigValue("AI_PARSING_PROVIDER");
  if (configured && KNOWN_PROVIDERS.has(configured)) return configured as ParsingProvider;
  return LEGACY_PROVIDER[type];
}
