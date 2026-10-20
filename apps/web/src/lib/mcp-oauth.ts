import { randomBytes, createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashToken, PAT_RATE_LIMIT_PER_MINUTE } from "@/lib/pat";

// MCP sign-in: a small OAuth 2.1 authorization server (authorization code +
// PKCE, dynamic client registration, rotating refresh tokens) so apps like
// Claude can connect to /api/mcp by signing in to Rooftap instead of pasting a
// bot API key. Tables are service-role only (20261020050000_mcp_oauth.sql).

export const ACCESS_TOKEN_PREFIX = "rt_oat_";
const REFRESH_TOKEN_PREFIX = "rt_ort_";
const CODE_PREFIX = "rt_oac_";
const CLIENT_PREFIX = "rt_client_";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const CODE_TTL_MS = 5 * 60 * 1000;
export const MCP_SCOPE = "mcp";

const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2000;
const MAX_CLIENT_NAME_LENGTH = 120;

function secret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("hex")}`;
}

// ── Discovery ──────────────────────────────────────────────────────────────

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [MCP_SCOPE],
    resource_name: "Rooftap",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
  };
}

// The 401 an MCP client reads to find the sign-in flow (MCP authorization spec).
export function wwwAuthenticate(origin: string): string {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}

// Discovery, registration and token endpoints are called by browser-based MCP
// clients too, so they answer any origin. None of them read cookies.
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
};

// ── Clients ────────────────────────────────────────────────────────────────

// https anywhere, or http only on the loopback host (desktop clients such as
// Claude Code catch the redirect on localhost). No fragments.
export function isAllowedRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > MAX_URI_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export interface OAuthClient {
  id: string;
  client_name: string | null;
  redirect_uris: string[];
}

export type RegistrationResult =
  | { ok: true; client: OAuthClient }
  | { ok: false; error: string; description: string };

export function parseRegistration(body: unknown): RegistrationResult {
  const b = (body ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, error: "invalid_redirect_uri", description: "Give 1 to 10 redirect_uris." };
  }
  if (!uris.every(isAllowedRedirectUri)) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris must be https, or http on localhost." };
  }
  const name = typeof b.client_name === "string" ? b.client_name.trim().slice(0, MAX_CLIENT_NAME_LENGTH) : null;
  return { ok: true, client: { id: secret(CLIENT_PREFIX).slice(0, CLIENT_PREFIX.length + 32), client_name: name || null, redirect_uris: uris } };
}

export async function saveClient(admin: SupabaseClient, client: OAuthClient): Promise<boolean> {
  const { error } = await admin.from("oauth_clients").insert(client);
  if (error) console.error("[oauth] client registration failed", error.message);
  return !error;
}

export async function getClient(admin: SupabaseClient, clientId: string | null): Promise<OAuthClient | null> {
  if (!clientId) return null;
  const { data } = await admin
    .from("oauth_clients")
    .select("id,client_name,redirect_uris")
    .eq("id", clientId)
    .maybeSingle();
  return data ?? null;
}

// ── Authorize ──────────────────────────────────────────────────────────────

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
}

export type AuthorizeCheck =
  // Safe to send the user back to redirect_uri with an error.
  | { ok: true; request: AuthorizeRequest; client: OAuthClient }
  // Not safe to redirect (unknown client or redirect_uri): show the error here.
  | { ok: false; message: string };

type ParamSource = { get(name: string): string | null };

export async function checkAuthorizeRequest(admin: SupabaseClient, params: ParamSource): Promise<AuthorizeCheck> {
  const client = await getClient(admin, params.get("client_id"));
  if (!client) return { ok: false, message: "This app isn't registered with Rooftap. Try connecting again from the app." };
  const redirectUri = params.get("redirect_uri");
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return { ok: false, message: "This app gave a return address Rooftap doesn't recognise." };
  }
  if (params.get("response_type") !== "code") {
    return { ok: false, message: "This app asked for an unsupported sign-in type." };
  }
  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge || params.get("code_challenge_method") !== "S256") {
    return { ok: false, message: "This app didn't send a secure sign-in challenge (PKCE S256)." };
  }
  return {
    ok: true,
    client,
    request: { clientId: client.id, redirectUri, codeChallenge, state: params.get("state") },
  };
}

export function redirectWith(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function createAuthorizationCode(
  admin: SupabaseClient,
  userId: string,
  request: AuthorizeRequest,
): Promise<string> {
  const code = secret(CODE_PREFIX);
  const { error } = await admin.from("oauth_authorization_codes").insert({
    code_hash: hashToken(code),
    client_id: request.clientId,
    user_id: userId,
    redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  return code;
}

// ── Token ──────────────────────────────────────────────────────────────────

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export type TokenResult = { ok: true; body: TokenResponse } | { ok: false; error: string; description: string };

function invalidGrant(description: string): TokenResult {
  return { ok: false, error: "invalid_grant", description };
}

function freshTokens() {
  const access = secret(ACCESS_TOKEN_PREFIX);
  const refresh = secret(REFRESH_TOKEN_PREFIX);
  return {
    access,
    refresh,
    row: {
      access_token_hash: hashToken(access),
      refresh_token_hash: hashToken(refresh),
      access_expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    },
  };
}

function tokenBody(access: string, refresh: string): TokenResponse {
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh,
    scope: MCP_SCOPE,
  };
}

export async function exchangeAuthorizationCode(
  admin: SupabaseClient,
  params: ParamSource,
): Promise<TokenResult> {
  const code = params.get("code");
  const verifier = params.get("code_verifier");
  if (!code || !verifier) return { ok: false, error: "invalid_request", description: "code and code_verifier are required." };

  // Codes are single use: delete first, then check what was deleted.
  const { data: row } = await admin
    .from("oauth_authorization_codes")
    .delete()
    .eq("code_hash", hashToken(code))
    .select("client_id,user_id,redirect_uri,code_challenge,expires_at")
    .maybeSingle();

  if (!row) return invalidGrant("Unknown or used code.");
  if (Date.parse(row.expires_at) <= Date.now()) return invalidGrant("Code expired.");
  const clientId = params.get("client_id");
  if (clientId && clientId !== row.client_id) return invalidGrant("Code was issued to another client.");
  const redirectUri = params.get("redirect_uri");
  if (redirectUri && redirectUri !== row.redirect_uri) return invalidGrant("redirect_uri doesn't match.");
  if (pkceChallenge(verifier) !== row.code_challenge) return invalidGrant("code_verifier doesn't match.");

  const tokens = freshTokens();
  const { error } = await admin.from("oauth_tokens").insert({
    client_id: row.client_id,
    user_id: row.user_id,
    ...tokens.row,
  });
  if (error) throw new Error(error.message);
  return { ok: true, body: tokenBody(tokens.access, tokens.refresh) };
}

export async function refreshAccessToken(admin: SupabaseClient, params: ParamSource): Promise<TokenResult> {
  const refresh = params.get("refresh_token");
  if (!refresh) return { ok: false, error: "invalid_request", description: "refresh_token is required." };

  const { data: row } = await admin
    .from("oauth_tokens")
    .select("id,client_id,revoked_at")
    .eq("refresh_token_hash", hashToken(refresh))
    .maybeSingle();
  if (!row || row.revoked_at != null) return invalidGrant("Unknown or revoked refresh token.");
  const clientId = params.get("client_id");
  if (clientId && clientId !== row.client_id) return invalidGrant("Refresh token was issued to another client.");

  // Rotate both tokens; the old refresh token stops working.
  const tokens = freshTokens();
  const { error } = await admin.from("oauth_tokens").update(tokens.row).eq("id", row.id);
  if (error) throw new Error(error.message);
  return { ok: true, body: tokenBody(tokens.access, tokens.refresh) };
}

// ── MCP access ─────────────────────────────────────────────────────────────

export interface OAuthIdentity {
  userId: string;
  tokenId: string;
}

export function isOAuthAccessToken(authHeader: string | null): boolean {
  const [scheme, token] = authHeader?.split(" ") ?? [];
  return scheme === "Bearer" && !!token?.startsWith(ACCESS_TOKEN_PREFIX);
}

export async function resolveOAuthUser(admin: SupabaseClient, authHeader: string | null): Promise<OAuthIdentity | null> {
  if (!isOAuthAccessToken(authHeader)) return null;
  const token = authHeader!.split(" ")[1];

  const { data: row } = await admin
    .from("oauth_tokens")
    .select("id,user_id,revoked_at,access_expires_at")
    .eq("access_token_hash", hashToken(token))
    .maybeSingle();

  if (!row || row.revoked_at != null) return null;
  if (Date.parse(row.access_expires_at) <= Date.now()) return null;

  // Builders are lazy: an un-awaited update never reaches the database.
  await admin.from("oauth_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return { userId: row.user_id, tokenId: row.id };
}

// Same budget and fail-open rule as checkPatRateLimit.
export async function checkOAuthRateLimit(admin: SupabaseClient, tokenId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("oauth_rate_limit_hit", {
    p_token_id: tokenId,
    p_limit: PAT_RATE_LIMIT_PER_MINUTE,
  });
  if (error) {
    console.error("[oauth] rate limit check failed", error.message);
    return true;
  }
  return data !== false;
}

// ── Connections (Settings) ─────────────────────────────────────────────────

export interface OAuthConnection {
  id: string;
  clientName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listConnections(admin: SupabaseClient, userId: string): Promise<OAuthConnection[]> {
  const { data } = await admin
    .from("oauth_tokens")
    .select("id,created_at,last_used_at,oauth_clients(client_name)")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => {
    const client = row.oauth_clients as { client_name: string | null } | { client_name: string | null }[] | null;
    const name = Array.isArray(client) ? client[0]?.client_name : client?.client_name;
    return {
      id: row.id,
      clientName: name || "Unnamed app",
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    };
  });
}

export async function revokeConnection(admin: SupabaseClient, userId: string, id: string): Promise<void> {
  await admin
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("revoked_at", null);
}
