import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  authorizationServerMetadata,
  checkAuthorizeRequest,
  exchangeAuthorizationCode,
  isAllowedRedirectUri,
  isOAuthAccessToken,
  parseRegistration,
  pkceChallenge,
  redirectWith,
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
