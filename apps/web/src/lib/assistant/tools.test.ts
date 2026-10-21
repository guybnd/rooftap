import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { DEFAULT_ASSISTANT_SETTINGS, type ModuleId } from "@homeup/core";
import type { createAdminClient } from "@/lib/supabase/admin";
import { assistantTools } from "./tools";

const ctx = (enabled: ModuleId[]) => ({
  admin: {} as ReturnType<typeof createAdminClient>,
  userId: "u1",
  groupId: null,
  enabled: new Set(enabled),
});

const gates = (tools: ReturnType<typeof assistantTools>) => Object.fromEntries(tools.map((t) => [t.name, t.gate]));

describe("assistantTools", () => {
  it("offers only switched-on modules' tools", () => {
    const names = assistantTools(ctx(["groceries"]), { settings: DEFAULT_ASSISTANT_SETTINGS }).map((t) => t.name);
    expect(names.every((n) => n.includes("grocery"))).toBe(true);
    expect(names).toContain("get_grocery_items");
  });

  it("proposes writes by default and always proposes deletes", () => {
    const g = gates(assistantTools(ctx(["groceries"]), { settings: { ...DEFAULT_ASSISTANT_SETTINGS, trust: { groceries: "act" } } }));
    expect(g.get_grocery_items).toBe("run");
    expect(g.create_grocery_item).toBe("run");
    expect(g.delete_grocery_item).toBe("propose");
    const d = gates(assistantTools(ctx(["groceries"]), { settings: DEFAULT_ASSISTANT_SETTINGS }));
    expect(d.create_grocery_item).toBe("propose");
  });

  it("hides writes under read trust and for read-only members", () => {
    const read = assistantTools(ctx(["household"]), { settings: { ...DEFAULT_ASSISTANT_SETTINGS, trust: { household: "read" } } });
    expect(read.map((t) => t.name)).toEqual(["get_tasks"]);
    const member = assistantTools(ctx(["household"]), { settings: DEFAULT_ASSISTANT_SETTINGS, readOnly: true });
    expect(member.map((t) => t.name)).toEqual(["get_tasks"]);
  });

  it("gives every tool an object JSON schema and validates arguments", async () => {
    const tools = assistantTools(ctx(["household"]), { settings: { ...DEFAULT_ASSISTANT_SETTINGS, trust: { household: "act" } } });
    for (const t of tools) expect(t.parameters.type).toBe("object");
    const create = tools.find((t) => t.name === "create_task")!;
    expect((create.parameters.properties as Record<string, unknown>).title).toBeDefined();
    const bad = await create.run({ title: 42 });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("Invalid arguments");
  });
});
