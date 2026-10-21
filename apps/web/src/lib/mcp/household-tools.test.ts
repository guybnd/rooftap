import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { MCP_TOOLS } from "@/lib/mcp-tools";
import { householdTools } from "./household-tools";
import type { createAdminClient } from "@/lib/supabase/admin";

const ctx = {
  admin: {} as ReturnType<typeof createAdminClient>,
  userId: "u1",
  groupId: null,
  enabled: new Set(MCP_TOOLS.map((t) => t.module)),
};

describe("householdTools", () => {
  it("lists exactly the tools in MCP_TOOLS, once each", () => {
    const names = householdTools(ctx).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
  });

  it("gives every tool a description and every write tool an input schema", () => {
    const writes = new Set(MCP_TOOLS.filter((t) => t.kind === "write").map((t) => t.name));
    for (const t of householdTools(ctx)) {
      expect(t.description.length).toBeGreaterThan(0);
      if (writes.has(t.name)) expect(t.inputSchema).toBeDefined();
    }
  });

  it("refuses writes without a household", async () => {
    const create = householdTools(ctx).find((t) => t.name === "create_task")!;
    const result = await create.handler({ title: "x" });
    expect(result.isError).toBe(true);
  });
});
