// HOUP-46: per-provider key validators for the admin API keys "Test" control.
// Each validator makes a single free, non-billable metadata call (never a
// completion) and normalizes that provider's quirky error semantics into a
// shared TestResult. See the ticket's "three traps" for why a naive
// `status === 200 ? valid : invalid` is wrong for Gemini, Mapbox, and the
// no-credit-vs-invalid distinction on OpenAI/ScraperAPI. Never echo the key
// value into a TestResult or a log line (C3).

export interface TestResult {
  status: "valid" | "invalid" | "no-credit" | "unreachable" | "unsupported";
  detail?: string;
}

const TIMEOUT_MS = 10_000;

async function testOpenAI(value: string): Promise<TestResult> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${value}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 200) return { status: "valid" };
    if (res.status === 401) return { status: "invalid" };
    // Out of credit, or region-blocked — the key itself authenticates fine.
    if (res.status === 429 || res.status === 403) return { status: "no-credit" };
    return { status: "unreachable", detail: `HTTP ${res.status}` };
  } catch {
    return { status: "unreachable" };
  }
}

async function testAnthropic(value: string): Promise<TestResult> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": value, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 200) return { status: "valid" };
    if (res.status === 401) return { status: "invalid" };
    if (res.status === 429) return { status: "unreachable" };
    return { status: "unreachable", detail: `HTTP ${res.status}` };
  } catch {
    return { status: "unreachable" };
  }
}

async function testGemini(value: string): Promise<TestResult> {
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      headers: { "x-goog-api-key": value },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 200) return { status: "valid" };
    if (res.status === 429) return { status: "unreachable" };
    // Key without API access — not a bad key, but not usable either.
    if (res.status === 403) return { status: "invalid" };
    if (res.status === 400) {
      // Gemini never returns 401 for a bad key; a bad key is a 400 with
      // reason "API_KEY_INVALID" buried in the error body.
      const body = await res.json().catch(() => null);
      if (JSON.stringify(body ?? {}).includes("API_KEY_INVALID")) return { status: "invalid" };
      return { status: "unreachable", detail: "HTTP 400" };
    }
    return { status: "unreachable", detail: `HTTP ${res.status}` };
  } catch {
    return { status: "unreachable" };
  }
}

async function testOpenRouter(value: string): Promise<TestResult> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${value}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 200) return { status: "valid" };
    if (res.status === 401) return { status: "invalid" };
    if (res.status === 429) return { status: "unreachable" };
    return { status: "unreachable", detail: `HTTP ${res.status}` };
  } catch {
    return { status: "unreachable" };
  }
}

async function testScraperAPI(value: string): Promise<TestResult> {
  try {
    const res = await fetch(`https://api.scraperapi.com/account?api_key=${encodeURIComponent(value)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 200) return { status: "valid" };
    if (res.status === 401) return { status: "invalid" };
    // Out of credit — the key authenticates fine.
    if (res.status === 403) return { status: "no-credit" };
    if (res.status === 429) return { status: "unreachable" };
    return { status: "unreachable", detail: `HTTP ${res.status}` };
  } catch {
    return { status: "unreachable" };
  }
}

async function testMapbox(value: string): Promise<TestResult> {
  try {
    const res = await fetch(`https://api.mapbox.com/tokens/v2?access_token=${encodeURIComponent(value)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return { status: "invalid" };
    if (res.status === 429) return { status: "unreachable" };
    if (res.status === 200) {
      // Mapbox returns 200 even for a bad token — truth is in the body.
      const body = await res.json().catch(() => null);
      if (body?.code === "TokenValid") return { status: "valid" };
      return { status: "invalid", detail: typeof body?.code === "string" ? body.code : undefined };
    }
    return { status: "unreachable", detail: `HTTP ${res.status}` };
  } catch {
    return { status: "unreachable" };
  }
}

// RFC 8292 §3.2: the VAPID public key is a 65-byte uncompressed P-256 point
// (leading 0x04), base64url-encoded without padding — exactly 87 characters.
// Purely local: no network call, so no rate limit and no credential to leak.
async function testVapidPublicKey(value: string): Promise<TestResult> {
  if (!/^[A-Za-z0-9_-]{87}$/.test(value)) {
    return { status: "invalid", detail: "Expected 87 base64url characters" };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(value, "base64url"));
  } catch {
    return { status: "invalid", detail: "Could not decode base64url" };
  }

  if (bytes.length !== 65) {
    return { status: "invalid", detail: `Expected 65 bytes, got ${bytes.length}` };
  }
  if (bytes[0] !== 0x04) {
    return { status: "invalid", detail: "Expected an uncompressed EC point (0x04 prefix)" };
  }
  return { status: "valid" };
}

export const KEY_VALIDATORS: Record<string, (value: string) => Promise<TestResult>> = {
  OPENAI_API_KEY: testOpenAI,
  ANTHROPIC_API_KEY: testAnthropic,
  GEMINI_API_KEY: testGemini,
  OPENROUTER_API_KEY: testOpenRouter,
  SCRAPER_API_KEY: testScraperAPI,
  NEXT_PUBLIC_MAPBOX_TOKEN: testMapbox,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: testVapidPublicKey,
};

// Separate from KEY_VALIDATORS: a paired probe (client id + secret), not a
// single-value validator. Google publishes no credential-validation endpoint;
// this relies on the documented error semantics of the token endpoint instead
// — "invalid_grant" means the client/secret pair is fine and only the bogus
// refresh token was rejected, "invalid_client" means the secret is wrong.
export async function testGoogleOAuthPair(clientId: string, clientSecret: string): Promise<TestResult> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: "homeup-key-test-probe-invalid-token",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) return { status: "unreachable" };

    const body = await res.json().catch(() => null);
    const error = body?.error;
    if (error === "invalid_grant") return { status: "valid" };
    if (error === "invalid_client") return { status: "invalid" };
    return { status: "unreachable", detail: error ? `Unexpected error: ${error}` : `HTTP ${res.status}` };
  } catch {
    return { status: "unreachable" };
  }
}
