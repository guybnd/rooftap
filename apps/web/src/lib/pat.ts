import { randomBytes, createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HouseholdTask, GroupEvent, GroceryItem } from '@homeup/core';

const TOKEN_PREFIX = "houp_pat_";

// Per-token MCP requests allowed per minute (pat_rate_limit_hit).
export const PAT_RATE_LIMIT_PER_MINUTE = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

// A key expires only if its owner picked a lifetime. null means never, and so
// does 'infinity', which the never-by-default migration wrote over the 90-day
// expiry the first version backfilled (Date.parse can't read it).
export function patExpiresAt(row: { expires_at?: string | null }): string | null {
  if (!row.expires_at || isNaN(Date.parse(row.expires_at))) return null;
  return row.expires_at;
}

export function isPatExpired(expiresAt: string | null, now = Date.now()): boolean {
  return expiresAt != null && Date.parse(expiresAt) <= now;
}

export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function issueToken(
  admin: SupabaseClient,
  userId: string,
  label: string,
  expiresInDays: number | null,
): Promise<string> {
  const raw = generateToken();
  await admin.from("personal_access_tokens").insert({
    user_id: userId,
    token_hash: hashToken(raw),
    label,
    expires_at: expiresInDays == null ? null : new Date(Date.now() + expiresInDays * DAY_MS).toISOString(),
  });
  return raw;
}

export interface PatIdentity {
  userId: string;
  patId: string;
}

export interface PatStatus {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

// Never selects token_hash — this is for self-service status display only.
export async function getActivePat(admin: SupabaseClient, userId: string): Promise<PatStatus | null> {
  const { data } = await admin
    .from("personal_access_tokens")
    .select("id,label,created_at,last_used_at,expires_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();

  if (!data) return null;
  const expiresAt = patExpiresAt(data);
  return {
    id: data.id,
    label: data.label,
    createdAt: data.created_at,
    lastUsedAt: data.last_used_at,
    expiresAt,
    expired: isPatExpired(expiresAt),
  };
}

// One-active-token-per-user enforcement: revokes every non-revoked token for
// this user (in practice at most one, but this is defensive against races).
export async function revokePat(admin: SupabaseClient, userId: string): Promise<void> {
  await admin
    .from("personal_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);
}

export async function resolvePatUser(admin: SupabaseClient, authHeader: string | null): Promise<PatIdentity | null> {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  const hash = hashToken(token);
  const { data: row } = await admin
    .from("personal_access_tokens")
    .select("id,user_id,revoked_at,expires_at")
    .eq("token_hash", hash)
    .single();

  if (!row || row.revoked_at != null) return null;
  if (isPatExpired(patExpiresAt(row))) return null;

  // Builders are lazy: an un-awaited update never reaches the database.
  await admin.from("personal_access_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);

  return { userId: row.user_id, patId: row.id };
}

// Counts this request against the token's per-minute budget. Fails open on a
// database error (e.g. a self-hosted server that hasn't applied the migration
// yet) so a counter problem never locks a household out of its own data.
export async function checkPatRateLimit(admin: SupabaseClient, patId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("pat_rate_limit_hit", {
    p_pat_id: patId,
    p_limit: PAT_RATE_LIMIT_PER_MINUTE,
  });
  if (error) {
    console.error("[pat] rate limit check failed", error.message);
    return true;
  }
  return data !== false;
}

export async function resolveGroupId(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data: membership } = await admin
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .limit(1)
    .single();

  return membership?.group_id ?? null;
}

export function visibleTasks(tasks: HouseholdTask[], userId: string): HouseholdTask[] {
  return tasks
    .filter((t) => !t.deleted)
    .filter((t) => !(t.private && t.assigned_to !== userId));
}

export function visibleEvents(events: GroupEvent[], userId: string): GroupEvent[] {
  return events
    .filter((e) => !e.deleted)
    .filter((e) => !(e.private && e.created_by !== userId));
}

export function visibleGroceryItems(items: GroceryItem[], userId: string): GroceryItem[] {
  return items
    .filter((i) => !i.deleted)
    .filter((i) => !(i.private && i.assigned_to !== userId));
}
