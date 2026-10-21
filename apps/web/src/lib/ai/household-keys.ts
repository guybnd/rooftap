import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiKeyProvider, type AiKeyProvider } from "@homeup/core";

// HOUP-436: a household's own AI keys, encrypted at rest in
// `household_ai_keys` (service role only). The key material is
// HOUSEHOLD_KEYS_SECRET; without it the server can't store new keys, and
// keys stored under a different secret are skipped as if unset. Rotating the
// secret means households re-enter their keys.

const VERSION = "v1";

function secretKey(): Buffer | null {
  const secret = process.env.HOUSEHOLD_KEYS_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  return createHash("sha256").update(secret).digest();
}

export function canStoreHouseholdKeys(): boolean {
  return secretKey() !== null;
}

export function encryptHouseholdKey(plain: string): string {
  const key = secretKey();
  if (!key) throw new Error("HOUSEHOLD_KEYS_SECRET is not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

/** The stored key in clear, or null when it can't be read with this server's secret. */
export function decryptHouseholdKey(stored: string): string | null {
  const key = secretKey();
  const [version, iv, tag, body] = stored.split(":");
  if (!key || version !== VERSION || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export interface StoredKeyRow {
  provider: string;
  encrypted_key: string;
  last4: string;
  created_at: string;
}

/** The household's stored keys as rows (no clear text). An older server without the table answers none. */
export async function householdKeyRows(admin: SupabaseClient, groupId: string): Promise<StoredKeyRow[]> {
  const { data, error } = await admin
    .from("household_ai_keys")
    .select("provider, encrypted_key, last4, created_at")
    .eq("group_id", groupId);
  if (error) return [];
  return (data ?? []) as StoredKeyRow[];
}

/** The household's usable keys in clear, by provider. */
export async function householdKeys(admin: SupabaseClient, groupId: string): Promise<Map<AiKeyProvider, string>> {
  const keys = new Map<AiKeyProvider, string>();
  for (const row of await householdKeyRows(admin, groupId)) {
    if (!isAiKeyProvider(row.provider)) continue;
    const plain = decryptHouseholdKey(row.encrypted_key);
    if (plain) keys.set(row.provider, plain);
  }
  return keys;
}
