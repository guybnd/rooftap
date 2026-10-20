import { describe, expect, it, vi } from "vitest";

// The route's auth gate calls resolvePatUser -> admin.from(...).select(...).eq(...).single()
// before any MCP protocol logic runs, so a chainable stub that always resolves to "no row
// found" is enough to exercise every rejection path without a live Supabase instance.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const builder = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      single: async () => ({ data: null, error: null }),
    };
    return { from: () => builder };
  },
}));

import { POST } from "./route";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

describe("MCP route auth gate (auth rejection matrix)", () => {
  it("401s when the Authorization header is missing", async () => {
    const res = await POST(request());
    expect(res.status).toBe(401);
  });

  it("401s for a non-Bearer scheme", async () => {
    const res = await POST(request({ authorization: "Basic dXNlcjpwYXNz" }));
    expect(res.status).toBe(401);
  });

  it("401s for a well-formed but unknown Bearer token", async () => {
    const res = await POST(request({ authorization: "Bearer houp_pat_doesnotexist" }));
    expect(res.status).toBe(401);
  });

  it("returns an identical body across missing/malformed/unknown-token cases (no enumeration)", async () => {
    const bodies = await Promise.all([
      POST(request()).then((r) => r.text()),
      POST(request({ authorization: "Basic dXNlcjpwYXNz" })).then((r) => r.text()),
      POST(request({ authorization: "Bearer houp_pat_doesnotexist" })).then((r) => r.text()),
    ]);
    expect(new Set(bodies).size).toBe(1);
  });
});
