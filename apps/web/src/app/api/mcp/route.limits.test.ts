import { beforeEach, describe, expect, it, vi } from "vitest";

// Token expiry and per-token rate limiting both gate the route before any
// household lookup, so only the token row and the rate-limit RPC are stubbed.
const state = vi.hoisted(() => ({
  patRow: null as Record<string, unknown> | null,
  withinLimit: true,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      update: () => builder,
      single: async () => ({ data: state.patRow, error: null }),
    };
    return {
      from: (table: string) => {
        if (table === "personal_access_tokens") return builder;
        throw new Error(`unexpected table in limits test: ${table}`);
      },
      rpc: async () => ({ data: state.withinLimit, error: null }),
    };
  },
}));

import { POST } from "./route";

function request(): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer houp_pat_limits-test-token",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("MCP route token expiry and rate limiting", () => {
  beforeEach(() => {
    state.withinLimit = true;
    state.patRow = {
      id: "pat-1",
      user_id: "user-a",
      revoked_at: null,
      expires_at: new Date(Date.now() + DAY_MS).toISOString(),
    };
  });

  it("401s for an expired token", async () => {
    state.patRow = { ...state.patRow, expires_at: new Date(Date.now() - 1000).toISOString() };
    const res = await POST(request());
    expect(res.status).toBe(401);
  });

  it("429s with Retry-After when the token is over its per-minute budget", async () => {
    state.withinLimit = false;
    const res = await POST(request());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});
