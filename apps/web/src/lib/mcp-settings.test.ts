import { describe, expect, it } from "vitest";
import { toolAllowed, type McpSettings } from "@/lib/mcp-settings";
import type { McpToolMeta } from "@/lib/mcp-tools";

const READ_TOOL: McpToolMeta = { name: "get_tasks", kind: "read", module: "household" };
const WRITE_TOOL: McpToolMeta = { name: "delete_task", kind: "write", module: "household" };
const OTHER_READ_TOOL: McpToolMeta = { name: "get_grocery_items", kind: "read", module: "groceries" };

function settings(overrides: Partial<McpSettings> = {}): McpSettings {
  return { enabled: true, readOnly: false, allowedTools: null, ...overrides };
}

describe("toolAllowed — the HOUP-26 registration conjunction", () => {
  it("disabled server blocks every tool regardless of read-only or allowlist", () => {
    expect(toolAllowed(settings({ enabled: false }), READ_TOOL)).toBe(false);
    expect(toolAllowed(settings({ enabled: false }), WRITE_TOOL)).toBe(false);
    expect(toolAllowed(settings({ enabled: false, allowedTools: ["get_tasks"] }), READ_TOOL)).toBe(false);
  });

  it("defaults (enabled, not read-only, allowlist null) reproduce today's behavior — every tool allowed", () => {
    expect(toolAllowed(settings(), READ_TOOL)).toBe(true);
    expect(toolAllowed(settings(), WRITE_TOOL)).toBe(true);
  });

  it("read-only with no allowlist exposes only read tools", () => {
    const s = settings({ readOnly: true });
    expect(toolAllowed(s, READ_TOOL)).toBe(true);
    expect(toolAllowed(s, WRITE_TOOL)).toBe(false);
  });

  it("an allowlist (not read-only) restricts to exactly the named tools", () => {
    const s = settings({ allowedTools: ["get_tasks", "delete_task"] });
    expect(toolAllowed(s, READ_TOOL)).toBe(true);
    expect(toolAllowed(s, WRITE_TOOL)).toBe(true);
    expect(toolAllowed(s, OTHER_READ_TOOL)).toBe(false);
  });

  it("empty allowlist blocks every tool", () => {
    const s = settings({ allowedTools: [] });
    expect(toolAllowed(s, READ_TOOL)).toBe(false);
    expect(toolAllowed(s, WRITE_TOOL)).toBe(false);
  });

  it("read-only intersects a mixed read+write allowlist — only the allow-listed read tool survives", () => {
    const s = settings({ readOnly: true, allowedTools: ["get_tasks", "delete_task"] });
    expect(toolAllowed(s, READ_TOOL)).toBe(true);
    expect(toolAllowed(s, WRITE_TOOL)).toBe(false);
  });

  it("read-only with an allowlist that omits a read tool still blocks it (allowlist still applies to reads)", () => {
    const s = settings({ readOnly: true, allowedTools: ["delete_task"] });
    expect(toolAllowed(s, READ_TOOL)).toBe(false);
    expect(toolAllowed(s, OTHER_READ_TOOL)).toBe(false);
  });
});
