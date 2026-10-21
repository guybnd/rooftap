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

export async function resolveParsingProvider(type: ParsingType): Promise<ParsingProvider> {
  const configured = await getAdminConfigValue("AI_PARSING_PROVIDER");
  if (configured && KNOWN_PROVIDERS.has(configured)) return configured as ParsingProvider;
  return LEGACY_PROVIDER[type];
}
