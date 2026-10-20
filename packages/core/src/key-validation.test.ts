import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Validators are pure functions of (value: string) => Promise<TestResult>
// with no DB access — mock global fetch directly rather than the Supabase
// client (contrast with admin-config.test.ts, which mocks @/lib/supabase/admin
// because resolveParsingProvider goes through the DB).
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { KEY_VALIDATORS, testGoogleOAuthPair } from "./key-validation";

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("KEY_VALIDATORS.OPENAI_API_KEY", () => {
  it("200 -> valid", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));
    expect(await KEY_VALIDATORS.OPENAI_API_KEY("sk-test")).toEqual({ status: "valid" });
  });

  it("401 -> invalid", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { message: "bad key" } }));
    const result = await KEY_VALIDATORS.OPENAI_API_KEY("sk-test");
    expect(result.status).toBe("invalid");
  });

  it("429 -> no-credit (valid key, out of credit, not invalid)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: { message: "rate limited" } }));
    const result = await KEY_VALIDATORS.OPENAI_API_KEY("sk-test");
    expect(result.status).toBe("no-credit");
  });

  it("403 -> no-credit (region-blocked, not a key problem)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: { message: "unsupported_country_region_territory" } }));
    const result = await KEY_VALIDATORS.OPENAI_API_KEY("sk-test");
    expect(result.status).toBe("no-credit");
  });

  it("network failure (e.g. AbortError from a timeout) -> unreachable", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const result = await KEY_VALIDATORS.OPENAI_API_KEY("sk-test");
    expect(result.status).toBe("unreachable");
  });

  it("never echoes the key value into the result", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    const result = await KEY_VALIDATORS.OPENAI_API_KEY("sk-super-secret-value");
    expect(JSON.stringify(result)).not.toContain("sk-super-secret-value");
  });
});

describe("KEY_VALIDATORS.ANTHROPIC_API_KEY", () => {
  it("200 -> valid, using x-api-key + anthropic-version header", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));
    const result = await KEY_VALIDATORS.ANTHROPIC_API_KEY("sk-ant-test");
    expect(result).toEqual({ status: "valid" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("api.anthropic.com/v1/models");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("401 -> invalid", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    expect((await KEY_VALIDATORS.ANTHROPIC_API_KEY("bad")).status).toBe("invalid");
  });

  it("429 -> unreachable (no explicit no-credit mapping for Anthropic)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}));
    expect((await KEY_VALIDATORS.ANTHROPIC_API_KEY("k")).status).toBe("unreachable");
  });

  it("network failure -> unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect((await KEY_VALIDATORS.ANTHROPIC_API_KEY("k")).status).toBe("unreachable");
  });
});

describe("KEY_VALIDATORS.GEMINI_API_KEY", () => {
  it("200 -> valid, using x-goog-api-key header (not ?key= query param)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { models: [] }));
    const result = await KEY_VALIDATORS.GEMINI_API_KEY("gm-test");
    expect(result).toEqual({ status: "valid" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("key=gm-test");
    expect(init.headers["x-goog-api-key"]).toBe("gm-test");
  });

  it("400 with reason API_KEY_INVALID -> invalid (trap: a naive status===401 check would miss this)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
          details: [{ reason: "API_KEY_INVALID" }],
        },
      })
    );
    const result = await KEY_VALIDATORS.GEMINI_API_KEY("bad-key");
    expect(result.status).toBe("invalid");
  });

  it("plain 403 -> invalid (key without API access)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, {}));
    expect((await KEY_VALIDATORS.GEMINI_API_KEY("k")).status).toBe("invalid");
  });

  it("a bad Gemini key never returns 401 to begin with -- confirming 401 is not part of Gemini's contract", async () => {
    // Regression guard for the trap: if the implementation naively checked
    // `res.status === 401 ? invalid : valid`, this 400/API_KEY_INVALID case
    // above would wrongly report "valid". Assert invalid is reachable via 400.
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } })
    );
    expect((await KEY_VALIDATORS.GEMINI_API_KEY("bad")).status).not.toBe("valid");
  });

  it("429 -> unreachable", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}));
    expect((await KEY_VALIDATORS.GEMINI_API_KEY("k")).status).toBe("unreachable");
  });

  it("network failure -> unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    expect((await KEY_VALIDATORS.GEMINI_API_KEY("k")).status).toBe("unreachable");
  });
});

describe("KEY_VALIDATORS.OPENROUTER_API_KEY", () => {
  it("200 -> valid", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { limit: null } }));
    const result = await KEY_VALIDATORS.OPENROUTER_API_KEY("sk-or-test");
    expect(result).toEqual({ status: "valid" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://openrouter.ai/api/v1/key");
    expect(init.headers.Authorization).toBe("Bearer sk-or-test");
  });

  it("401 -> invalid", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    expect((await KEY_VALIDATORS.OPENROUTER_API_KEY("k")).status).toBe("invalid");
  });

  it("429 -> unreachable", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}));
    expect((await KEY_VALIDATORS.OPENROUTER_API_KEY("k")).status).toBe("unreachable");
  });

  it("network failure -> unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    expect((await KEY_VALIDATORS.OPENROUTER_API_KEY("k")).status).toBe("unreachable");
  });
});

describe("KEY_VALIDATORS.SCRAPER_API_KEY", () => {
  it("200 -> valid, key sent as a query param only (no Authorization header)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { requestCount: 10 }));
    const result = await KEY_VALIDATORS.SCRAPER_API_KEY("sa-test");
    expect(result).toEqual({ status: "valid" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("api_key=sa-test");
    expect(init?.headers?.Authorization).toBeUndefined();
  });

  it("401 -> invalid", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    expect((await KEY_VALIDATORS.SCRAPER_API_KEY("k")).status).toBe("invalid");
  });

  it("403 -> no-credit (trap: out of credit, not invalid)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, {}));
    expect((await KEY_VALIDATORS.SCRAPER_API_KEY("k")).status).toBe("no-credit");
  });

  it("429 -> unreachable (no explicit no-credit mapping for this status)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}));
    expect((await KEY_VALIDATORS.SCRAPER_API_KEY("k")).status).toBe("unreachable");
  });

  it("network failure -> unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    expect((await KEY_VALIDATORS.SCRAPER_API_KEY("k")).status).toBe("unreachable");
  });
});

describe("KEY_VALIDATORS.NEXT_PUBLIC_MAPBOX_TOKEN", () => {
  it("200 with code TokenValid -> valid", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: "TokenValid", token: "pk.test" }));
    expect(await KEY_VALIDATORS.NEXT_PUBLIC_MAPBOX_TOKEN("pk.test")).toEqual({ status: "valid" });
  });

  it("200 with code TokenInvalid -> invalid (trap: a naive status===200 check is insufficient)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: "TokenInvalid" }));
    const result = await KEY_VALIDATORS.NEXT_PUBLIC_MAPBOX_TOKEN("pk.bad");
    expect(result.status).toBe("invalid");
  });

  it.each(["TokenMalformed", "TokenExpired", "TokenRevoked"])("200 with code %s -> invalid", async (code) => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code }));
    expect((await KEY_VALIDATORS.NEXT_PUBLIC_MAPBOX_TOKEN("pk.bad")).status).toBe("invalid");
  });

  it("401 -> invalid", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    expect((await KEY_VALIDATORS.NEXT_PUBLIC_MAPBOX_TOKEN("k")).status).toBe("invalid");
  });

  it("429 -> unreachable", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}));
    expect((await KEY_VALIDATORS.NEXT_PUBLIC_MAPBOX_TOKEN("k")).status).toBe("unreachable");
  });

  it("network failure -> unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    expect((await KEY_VALIDATORS.NEXT_PUBLIC_MAPBOX_TOKEN("k")).status).toBe("unreachable");
  });
});

describe("KEY_VALIDATORS.NEXT_PUBLIC_VAPID_PUBLIC_KEY", () => {
  // A syntactically valid 87-char base64url string decoding to 65 bytes with
  // a leading 0x04 (uncompressed EC point). Built rather than hand-typed so
  // the byte-level assertions below are guaranteed to hold.
  function makeVapidKey(leadingByte: number, byteLength = 65): string {
    const bytes = new Uint8Array(byteLength);
    bytes[0] = leadingByte;
    for (let i = 1; i < byteLength; i++) bytes[i] = i % 256;
    return Buffer.from(bytes).toString("base64url");
  }

  it("does not call fetch -- purely local", async () => {
    await KEY_VALIDATORS.NEXT_PUBLIC_VAPID_PUBLIC_KEY(makeVapidKey(0x04));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("correct 87-char key, 65 bytes, leading 0x04 -> valid", async () => {
    const key = makeVapidKey(0x04);
    expect(key).toHaveLength(87);
    expect(await KEY_VALIDATORS.NEXT_PUBLIC_VAPID_PUBLIC_KEY(key)).toEqual({ status: "valid" });
  });

  it("wrong length -> invalid", async () => {
    const tooShort = makeVapidKey(0x04, 40).slice(0, 40);
    const result = await KEY_VALIDATORS.NEXT_PUBLIC_VAPID_PUBLIC_KEY(tooShort);
    expect(result.status).toBe("invalid");
  });

  it("right length (87 chars, 65 bytes) but wrong leading byte -> invalid", async () => {
    const key = makeVapidKey(0x05);
    expect(key).toHaveLength(87);
    const result = await KEY_VALIDATORS.NEXT_PUBLIC_VAPID_PUBLIC_KEY(key);
    expect(result.status).toBe("invalid");
  });
});

describe("testGoogleOAuthPair", () => {
  it("POSTs to the token endpoint with a bogus refresh_token grant", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: "invalid_grant" }));
    await testGoogleOAuthPair("client-id", "client-secret");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    const sentBody = String(init.body);
    expect(sentBody).toContain("client_id=client-id");
    expect(sentBody).toContain("client_secret=client-secret");
    expect(sentBody).toContain("grant_type=refresh_token");
  });

  it("error invalid_grant -> valid (secret is fine, refresh token is just bogus as expected)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: "invalid_grant" }));
    expect(await testGoogleOAuthPair("id", "secret")).toEqual({ status: "valid" });
  });

  it("error invalid_client -> invalid (wrong secret)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "invalid_client" }));
    expect((await testGoogleOAuthPair("id", "wrong-secret")).status).toBe("invalid");
  });

  it("429 -> unreachable", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}));
    expect((await testGoogleOAuthPair("id", "secret")).status).toBe("unreachable");
  });

  it("network failure -> unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    expect((await testGoogleOAuthPair("id", "secret")).status).toBe("unreachable");
  });
});
