import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  authorizationServerMetadata,
  checkAuthorizeRequest,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  isAllowedRedirectUri,
  isOAuthAccessToken,
  parseRegistration,
  pkceChallenge,
  redirectWith,
  refreshAccessToken,
  wwwAuthenticate,
} from "./mcp-oauth";
import { safeNextPath } from "./next-path";

// Minimal chainable stand-in for the admin client: every query resolves to `row`.
function adminReturning(row: unknown) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "delete", "update", "insert", "order"]) builder[m] = () => builder;
  builder.maybeSingle = async () => ({ data: row, error: null });
  return { from: () => builder } as never;
}

const client = { id: "rt_client_abc", client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] };

function params(values: Record<string, string>) {
  return new URLSearchParams(values);
}

describe("redirect URIs", () => {
  it("allows https and loopback http only", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:33418/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://evil.example/cb")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri(42)).toBe(false);
  });

  it("registration rejects bad or missing redirect_uris and keeps the name", () => {
    expect(parseRegistration({}).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: ["http://evil.example/cb"] }).ok).toBe(false);
    const ok = parseRegistration({ redirect_uris: client.redirect_uris, client_name: " Claude " });
    expect(ok.ok && ok.client.client_name).toBe("Claude");
    expect(ok.ok && ok.client.id.startsWith("rt_client_")).toBe(true);
  });
});

describe("authorize request", () => {
  const good = {
    client_id: client.id,
    redirect_uri: client.redirect_uris[0],
    response_type: "code",
    code_challenge: "abc",
    code_challenge_method: "S256",
    state: "xyz",
  };

  it("accepts a registered client with PKCE S256", async () => {
    const check = await checkAuthorizeRequest(adminReturning(client), params(good));
    expect(check.ok && check.request.state).toBe("xyz");
  });

  it("refuses unknown clients, foreign redirect URIs and missing PKCE", async () => {
    expect((await checkAuthorizeRequest(adminReturning(null), params(good))).ok).toBe(false);
    expect(
      (await checkAuthorizeRequest(adminReturning(client), params({ ...good, redirect_uri: "https://evil.example/cb" }))).ok,
    ).toBe(false);
    expect((await checkAuthorizeRequest(adminReturning(client), params({ ...good, code_challenge_method: "plain" }))).ok).toBe(
      false,
    );
  });

  it("adds code and state to the return address", () => {
    expect(redirectWith("https://claude.ai/cb?x=1", { code: "c", state: null })).toBe("https://claude.ai/cb?x=1&code=c");
  });
});

describe("code exchange", () => {
  const verifier = "a".repeat(50);
  const row = {
    client_id: client.id,
    user_id: "user-1",
    redirect_uri: client.redirect_uris[0],
    code_challenge: pkceChallenge(verifier),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };

  it("computes the S256 challenge as base64url(sha256(verifier))", () => {
    expect(pkceChallenge(verifier)).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("issues tokens for a matching verifier", async () => {
    const result = await exchangeAuthorizationCode(
      adminReturning(row),
      params({ code: "c", code_verifier: verifier, client_id: client.id }),
    );
    expect(result.ok && result.body.access_token.startsWith("rt_oat_")).toBe(true);
    expect(result.ok && result.body.refresh_token.startsWith("rt_ort_")).toBe(true);
  });

  it("refuses a wrong verifier, another client, or an expired code", async () => {
    const wrong = await exchangeAuthorizationCode(adminReturning(row), params({ code: "c", code_verifier: "b".repeat(50) }));
    expect(wrong.ok).toBe(false);
    const other = await exchangeAuthorizationCode(
      adminReturning(row),
      params({ code: "c", code_verifier: verifier, client_id: "rt_client_other" }),
    );
    expect(other.ok).toBe(false);
    const expired = await exchangeAuthorizationCode(
      adminReturning({ ...row, expires_at: new Date(Date.now() - 1).toISOString() }),
      params({ code: "c", code_verifier: verifier }),
    );
    expect(expired.ok).toBe(false);
    const used = await exchangeAuthorizationCode(adminReturning(null), params({ code: "c", code_verifier: verifier }));
    expect(used.ok).toBe(false);
  });
  // A shared device is chosen on the consent screen and must reach the token.
  function recordingAdmin(row: unknown) {
    const inserts: Record<string, unknown>[] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "delete"]) builder[m] = () => builder;
    builder.insert = (value: Record<string, unknown>) => {
      inserts.push(value);
      return Promise.resolve({ error: null });
    };
    builder.maybeSingle = async () => ({ data: row, error: null });
    return { admin: { from: () => builder } as never, inserts };
  }

  it("carries the shared device mark from the code to the token", async () => {
    const shared = recordingAdmin({ ...row, shared_device: true });
    await exchangeAuthorizationCode(shared.admin, params({ code: "c", code_verifier: verifier }));
    expect(shared.inserts[0].shared_device).toBe(true);

    // A normal code, or one from before the column existed, never sends it.
    for (const r of [{ ...row, shared_device: false }, row]) {
      const plain = recordingAdmin(r);
      await exchangeAuthorizationCode(plain.admin, params({ code: "c", code_verifier: verifier }));
      expect("shared_device" in plain.inserts[0]).toBe(false);
    }
  });

  it("stores the shared device mark on the code only when it is set", async () => {
    const request = { clientId: client.id, redirectUri: client.redirect_uris[0], codeChallenge: "x", state: null };
    const shared = recordingAdmin(null);
    await createAuthorizationCode(shared.admin, "user-1", request, true);
    expect(shared.inserts[0].shared_device).toBe(true);
    const plain = recordingAdmin(null);
    await createAuthorizationCode(plain.admin, "user-1", request);
    expect("shared_device" in plain.inserts[0]).toBe(false);
  });
});

// A different row per table, for flows that read a code or token and then its client.
function adminByTable(rows: Record<string, unknown>) {
  return {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "delete", "update"]) builder[m] = () => builder;
      builder.insert = async () => ({ error: null });
      builder.then = (resolve: (v: unknown) => void) => resolve({ error: null });
      builder.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
      return builder;
    },
  } as never;
}

describe("sign-in with a client secret", () => {
  const registered = parseRegistration({
    client_name: "Home Assistant",
    redirect_uris: ["https://my.home-assistant.io/redirect/oauth"],
    token_endpoint_auth_method: "client_secret_post",
  });
  if (!registered.ok || !registered.clientSecret) throw new Error("registration failed");
  const secretClient = registered.client;
  const clientSecret = registered.clientSecret;
  const codeRow = {
    client_id: secretClient.id,
    user_id: "u1",
    redirect_uri: secretClient.redirect_uris[0],
    code_challenge: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  const noPkce = { client_id: secretClient.id, redirect_uri: secretClient.redirect_uris[0], response_type: "code" };

  it("stores only a hash of the secret, and only when asked", () => {
    expect(secretClient.client_secret_hash).toBeTruthy();
    expect(JSON.stringify(secretClient)).not.toContain(clientSecret);
    for (const body of [{ redirect_uris: client.redirect_uris }, { redirect_uris: client.redirect_uris, token_endpoint_auth_method: "none" }]) {
      const plain = parseRegistration(body);
      expect(plain.ok && !plain.clientSecret && !("client_secret_hash" in plain.client)).toBe(true);
    }
  });

  it("lets only a secret client skip PKCE at authorize", async () => {
    const ok = await checkAuthorizeRequest(adminReturning(secretClient), params(noPkce));
    expect(ok.ok && ok.request.codeChallenge).toBe(null);
    const publicClient = await checkAuthorizeRequest(
      adminReturning(client),
      params({ client_id: client.id, redirect_uri: client.redirect_uris[0], response_type: "code" }),
    );
    expect(publicClient.ok).toBe(false);
    const weak = await checkAuthorizeRequest(adminReturning(secretClient), params({ ...noPkce, code_challenge: "a", code_challenge_method: "plain" }));
    expect(weak.ok).toBe(false);
  });

  it("issues tokens for the right secret only", async () => {
    const admin = () => adminByTable({ oauth_authorization_codes: codeRow, oauth_clients: secretClient });
    expect((await exchangeAuthorizationCode(admin(), params({ code: "c", client_secret: clientSecret }))).ok).toBe(true);
    expect((await exchangeAuthorizationCode(admin(), params({ code: "c", client_secret: "rt_ocs_wrong" }))).ok).toBe(false);
    expect((await exchangeAuthorizationCode(admin(), params({ code: "c" }))).ok).toBe(false);
  });

  it("refuses a code with no challenge for a client with no secret", async () => {
    const admin = adminByTable({ oauth_authorization_codes: { ...codeRow, client_id: client.id, redirect_uri: client.redirect_uris[0] }, oauth_clients: client });
    expect((await exchangeAuthorizationCode(admin, params({ code: "c", client_secret: "anything" }))).ok).toBe(false);
  });

  it("still requires the verifier when a code has a challenge, and the secret too if the client has one", async () => {
    const verifier = "a".repeat(50);
    const withChallenge = { ...codeRow, code_challenge: pkceChallenge(verifier) };
    const pub = adminByTable({ oauth_authorization_codes: { ...withChallenge, client_id: client.id, redirect_uri: client.redirect_uris[0] }, oauth_clients: client });
    expect((await exchangeAuthorizationCode(pub, params({ code: "c" }))).ok).toBe(false);
    expect((await exchangeAuthorizationCode(pub, params({ code: "c", code_verifier: verifier }))).ok).toBe(true);
    const sec = adminByTable({ oauth_authorization_codes: withChallenge, oauth_clients: secretClient });
    expect((await exchangeAuthorizationCode(sec, params({ code: "c", code_verifier: verifier }))).ok).toBe(false);
  });

  it("fails closed when the client can't be read", async () => {
    const admin = adminByTable({ oauth_authorization_codes: { ...codeRow, code_challenge: pkceChallenge("a".repeat(50)) } });
    expect((await exchangeAuthorizationCode(admin, params({ code: "c", code_verifier: "a".repeat(50) }))).ok).toBe(false);
  });

  it("needs the secret to refresh, and leaves a public client alone", async () => {
    const tokenRow = { id: "t1", client_id: secretClient.id, revoked_at: null };
    const sec = () => adminByTable({ oauth_tokens: tokenRow, oauth_clients: secretClient });
    expect((await refreshAccessToken(sec(), params({ refresh_token: "r", client_secret: clientSecret }))).ok).toBe(true);
    expect((await refreshAccessToken(sec(), params({ refresh_token: "r" }))).ok).toBe(false);
    const pub = adminByTable({ oauth_tokens: { ...tokenRow, client_id: client.id }, oauth_clients: client });
    expect((await refreshAccessToken(pub, params({ refresh_token: "r" }))).ok).toBe(true);
  });
});

describe("discovery and routing", () => {
  it("points the 401 and metadata at this origin", () => {
    const meta = authorizationServerMetadata("https://homeup.vercel.app");
    expect(meta.token_endpoint).toBe("https://homeup.vercel.app/api/oauth/token");
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(wwwAuthenticate("https://homeup.vercel.app")).toContain(
      'resource_metadata="https://homeup.vercel.app/.well-known/oauth-protected-resource"',
    );
  });

  it("tells sign-in tokens from bot API keys", () => {
    expect(isOAuthAccessToken("Bearer rt_oat_123")).toBe(true);
    expect(isOAuthAccessToken("Bearer houp_pat_123")).toBe(false);
    expect(isOAuthAccessToken(null)).toBe(false);
  });

  it("only follows same-site paths after login", () => {
    expect(safeNextPath("/oauth/authorize?client_id=x")).toBe("/oauth/authorize?client_id=x");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
