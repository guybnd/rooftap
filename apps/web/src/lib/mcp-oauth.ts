import { randomBytes, createHash, timingSafeEqual } from "crypto";
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
const CLIENT_SECRET_PREFIX = "rt_ocs_";
// A server-side app can't do PKCE (Home Assistant's MCP integration, for one).
// It asks for this at registration, gets a secret once, and proves itself with
// the secret at the token endpoint. Not in the discovery document: clients that
// read it keep using PKCE as before.
const SECRET_AUTH_METHOD = "client_secret_post";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const CODE_TTL_MS = 5 * 60 * 1000;
export const MCP_SCOPE = "mcp";
// A shared device is a connection the person marked on the consent screen as
// one the whole household can hear, such as a voice speaker: it signs in as one
// person, but anyone in the room hears the answers. The mark lives on the
// connection (oauth_tokens.shared_device), not on the app, so the same app can
// be a private connection for one person and a shared one for another.
const SHARED_DEVICE_HIDDEN_TOOLS: ReadonlySet<string> = new Set(["add_occasion", "add_gift_ideas", "add_wishlist_items"]);

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
  /** Set for a server-side app that signs in with a secret instead of PKCE. */
  client_secret_hash?: string | null;
}

export type RegistrationResult =
  // clientSecret is the only copy: only its hash is stored.
  | { ok: true; client: OAuthClient; clientSecret?: string }
  | { ok: false; error: string; description: string };

export function parseRegistration(body: unknown): RegistrationResult {
  const b = (body ?? {}) as { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown };
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, error: "invalid_redirect_uri", description: "Give 1 to 10 redirect_uris." };
  }
  if (!uris.every(isAllowedRedirectUri)) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris must be https, or http on localhost." };
  }
  const name = typeof b.client_name === "string" ? b.client_name.trim().slice(0, MAX_CLIENT_NAME_LENGTH) : null;
  const client: OAuthClient = { id: secret(CLIENT_PREFIX).slice(0, CLIENT_PREFIX.length + 32), client_name: name || null, redirect_uris: uris };
  if (b.token_endpoint_auth_method !== SECRET_AUTH_METHOD) return { ok: true, client };
  const clientSecret = secret(CLIENT_SECRET_PREFIX);
  return { ok: true, client: { ...client, client_secret_hash: hashToken(clientSecret) }, clientSecret };
}

function secretMatches(client: OAuthClient, sent: string | null): boolean {
  if (!sent || !client.client_secret_hash) return false;
  const a = Buffer.from(hashToken(sent));
  const b = Buffer.from(client.client_secret_hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A tool a shared-device connection may see and call. Other connections are not limited here. */
export function sharedDeviceAllows(tool: { name: string }): boolean {
  return !SHARED_DEVICE_HIDDEN_TOOLS.has(tool.name);
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
    // "*" rather than a column list: client_secret_hash may not exist yet when
    // this code deploys ahead of its migration.
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  return data ?? null;
}

// ── Authorize ──────────────────────────────────────────────────────────────

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  /** Null only for a client that signs in with a secret. */
  codeChallenge: string | null;
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
  const pkceOk = !!codeChallenge && params.get("code_challenge_method") === "S256";
  // PKCE stays required, except for a client that proves itself with a secret.
  const secretOk = !codeChallenge && !!client.client_secret_hash;
  if (!pkceOk && !secretOk) {
    return { ok: false, message: "This app didn't send a secure sign-in challenge (PKCE S256)." };
  }
  return {
    ok: true,
    client,
    request: { clientId: client.id, redirectUri, codeChallenge: codeChallenge || null, state: params.get("state") },
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
  sharedDevice = false,
): Promise<string> {
  const code = secret(CODE_PREFIX);
  const { error } = await admin.from("oauth_authorization_codes").insert({
    code_hash: hashToken(code),
    client_id: request.clientId,
    user_id: userId,
    redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    // Only sent when set, so a plain sign-in works before the column exists.
    ...(sharedDevice ? { shared_device: true } : {}),
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
  if (!code) return { ok: false, error: "invalid_request", description: "code is required." };

  // Codes are single use: delete first, then check what was deleted.
  const { data: row } = await admin
    .from("oauth_authorization_codes")
    .delete()
    .eq("code_hash", hashToken(code))
    // "*" rather than a column list: shared_device may not exist yet when this
    // code deploys ahead of its migration.
    .select("*")
    .maybeSingle();

  if (!row) return invalidGrant("Unknown or used code.");
  if (Date.parse(row.expires_at) <= Date.now()) return invalidGrant("Code expired.");
  const clientId = params.get("client_id");
  if (clientId && clientId !== row.client_id) return invalidGrant("Code was issued to another client.");
  const redirectUri = params.get("redirect_uri");
  if (redirectUri && redirectUri !== row.redirect_uri) return invalidGrant("redirect_uri doesn't match.");
  if (row.code_challenge) {
    if (!verifier) return { ok: false, error: "invalid_request", description: "code_verifier is required." };
    if (pkceChallenge(verifier) !== row.code_challenge) return invalidGrant("code_verifier doesn't match.");
  }
  // A client with a secret always proves it, and a code with no challenge can
  // only belong to such a client. A failed lookup fails closed.
  const codeClient = await getClient(admin, row.client_id);
  if (!codeClient) return invalidGrant("Unknown client.");
  if (codeClient.client_secret_hash || !row.code_challenge) {
    if (!secretMatches(codeClient, params.get("client_secret"))) return invalidGrant("client_secret doesn't match.");
  }

  const tokens = freshTokens();
  const { error } = await admin.from("oauth_tokens").insert({
    client_id: row.client_id,
    user_id: row.user_id,
    ...(row.shared_device === true ? { shared_device: true } : {}),
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
  const refreshClient = await getClient(admin, row.client_id);
  if (!refreshClient) return invalidGrant("Unknown client.");
  if (refreshClient.client_secret_hash && !secretMatches(refreshClient, params.get("client_secret"))) {
    return invalidGrant("client_secret doesn't match.");
  }

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
  /** The person marked this connection as a shared device on the consent screen. */
  sharedDevice: boolean;
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
    // "*" so shared_device is read when it exists, and older schemas still work.
    .select("*")
    .eq("access_token_hash", hashToken(token))
    .maybeSingle();

  if (!row || row.revoked_at != null) return null;
  if (Date.parse(row.access_expires_at) <= Date.now()) return null;

  // Builders are lazy: an un-awaited update never reaches the database.
  await admin.from("oauth_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return { userId: row.user_id, tokenId: row.id, sharedDevice: row.shared_device === true };
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
  sharedDevice: boolean;
}

export async function listConnections(admin: SupabaseClient, userId: string): Promise<OAuthConnection[]> {
  const { data } = await admin
    .from("oauth_tokens")
    .select("*,oauth_clients(client_name)")
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
      sharedDevice: row.shared_device === true,
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
