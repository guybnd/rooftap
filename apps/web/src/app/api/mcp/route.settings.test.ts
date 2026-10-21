import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_MODULE_IDS, type ModuleId } from "@homeup/core";
import { MCP_TOOLS } from "@/lib/mcp-tools";

// Drives buildServer()'s settings gate (src/app/api/mcp/route.ts) end-to-end
// through the real POST handler via tools/list, with a mutable user_settings
// row so each test can exercise a different point in the enabled/read-only/
// allowlist matrix (HOUP-26 "Recommended Tests").
let userSettingsRow: Record<string, unknown> | null = null;

// The household's group_modules rows: every module on, unless a test changes them.
const allOnRows = () => ALL_MODULE_IDS.map((id) => ({ module_id: id, enabled: true }));
let moduleRows: { module_id: string; enabled: boolean }[] = allOnRows();
afterEach(() => {
  moduleRows = allOnRows();
});
const withModulesOff = (...off: ModuleId[]) =>
  ALL_MODULE_IDS.map((id) => ({ module_id: id, enabled: !off.includes(id) }));

function chainable(singleRow: unknown) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => builder,
    update: () => builder,
    single: async () => ({ data: singleRow, error: null }),
    maybeSingle: async () => ({ data: singleRow, error: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // pat_rate_limit_hit: always within budget here (route.limits.test.ts covers 429).
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => {
      if (table === "personal_access_tokens") {
        return chainable({ id: "pat-1", user_id: "user-a", revoked_at: null });
      }
      if (table === "group_members") {
        return chainable({ group_id: "group-a" });
      }
      if (table === "user_settings") {
        return chainable(userSettingsRow);
      }
      if (table === "group_modules") {
        return { select: () => ({ eq: async () => ({ data: moduleRows, error: null }) }) };
      }
      throw new Error(`unexpected table in settings test: ${table}`);
    },
  }),
}));

import { POST } from "./route";

function listRequest(): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer houp_pat_settings-test-token",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

async function listToolNames(): Promise<string[]> {
  const res = await POST(listRequest());
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.result.tools.map((t: { name: string }) => t.name).sort();
}

const ALL_NAMES = MCP_TOOLS.map((t) => t.name).sort();
const READ_NAMES = MCP_TOOLS.filter((t) => t.kind === "read").map((t) => t.name).sort();

describe("MCP settings gate (HOUP-26) — buildServer's registration conjunction via tools/list", () => {
  it("no user_settings row (brand-new user) fails safe to every tool exposed", async () => {
    userSettingsRow = null;
    expect(await listToolNames()).toEqual(ALL_NAMES);
  });

  it("mcp_enabled=false registers zero tools, so the tools capability itself never comes up and tools/list fails", async () => {
    // No registerTool call ever fires, so the SDK never wires up its
    // tools/list handler (McpServer.setToolRequestHandlers only runs from
    // inside registerTool) — a JSON-RPC error, not an empty tools array.
    // This is exactly the AC: "every tool call fails" while the PAT stays valid.
    userSettingsRow = { mcp_enabled: false, mcp_read_only: false, mcp_allowed_tools: null };
    const res = await POST(listRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.result).toBeUndefined();
  });

  it("read-only with no allowlist exposes only the read tools", async () => {
    userSettingsRow = { mcp_enabled: true, mcp_read_only: true, mcp_allowed_tools: null };
    expect(await listToolNames()).toEqual(READ_NAMES);
  });

  it("read-only with a mixed read+write allowlist exposes only the allow-listed read tools (intersection)", async () => {
    userSettingsRow = {
      mcp_enabled: true,
      mcp_read_only: true,
      mcp_allowed_tools: ["get_tasks", "delete_task", "get_grocery_items"],
    };
    expect(await listToolNames()).toEqual(["get_grocery_items", "get_tasks"]);
  });

  it("an allowlist without read-only exposes exactly the checked tools", async () => {
    userSettingsRow = { mcp_enabled: true, mcp_read_only: false, mcp_allowed_tools: ["get_tasks", "delete_task"] };
    expect(await listToolNames()).toEqual(["delete_task", "get_tasks"]);
  });

  it("defaults (enabled, not read-only, allowlist null) reproduce today's behavior", async () => {
    userSettingsRow = { mcp_enabled: true, mcp_read_only: false, mcp_allowed_tools: null };
    expect(await listToolNames()).toEqual(ALL_NAMES);
  });
});

describe("MCP module gate (.docs/modules.md) — the endpoint and its tools follow the household's modules", () => {
  it("with the MCP module off, the endpoint answers 404 even to a valid token", async () => {
    userSettingsRow = null;
    moduleRows = withModulesOff("mcp");
    const res = await POST(listRequest());
    expect(res.status).toBe(404);
  });

  it("a household with no module rows gets the defaults, where MCP is off", async () => {
    userSettingsRow = null;
    moduleRows = [];
    const res = await POST(listRequest());
    expect(res.status).toBe(404);
  });

  it("a switched-off module's tools aren't registered", async () => {
    userSettingsRow = null;
    moduleRows = withModulesOff("costs", "groceries");
    const names = MCP_TOOLS.filter((t) => t.module !== "costs" && t.module !== "groceries").map((t) => t.name).sort();
    expect(await listToolNames()).toEqual(names);
  });

  it("modules and settings combine: read-only with Tasks off leaves the other read tools", async () => {
    userSettingsRow = { mcp_enabled: true, mcp_read_only: true, mcp_allowed_tools: null };
    moduleRows = withModulesOff("household");
    const reads = MCP_TOOLS.filter((t) => t.kind === "read" && t.module !== "household").map((t) => t.name).sort();
    expect(reads).toContain("get_budget_summary");
    expect(await listToolNames()).toEqual(reads);
  });
});
