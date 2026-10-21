import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/session", () => ({ getSessionUser: vi.fn() }));

import { DEFAULT_ASSISTANT_SETTINGS, PLUS_ASSISTANT_ALLOWANCE_CENTS } from "@homeup/core";
import { billingMode, budgetFor, toHistory, toMessage, turnCost } from "./service";

const row = (over: Record<string, unknown>) =>
  ({
    id: "m",
    conversation_id: "c",
    group_id: "g",
    user_id: "u1",
    role: "user",
    content: "",
    tool_calls: null,
    proposal: null,
    proposal_state: null,
    channel: "app",
    cost_micros: null,
    created_at: "2026-10-21T00:00:00Z",
    ...over,
  }) as Parameters<typeof toMessage>[0];

describe("toHistory", () => {
  it("rebuilds tool steps and drops anything before the first user message", () => {
    const history = toHistory([
      row({ role: "tool", content: "orphan", tool_calls: { toolCallId: "x", name: "get_tasks" } }),
      row({ role: "user", content: "add milk" }),
      row({ role: "assistant", content: "", tool_calls: [{ id: "c1", name: "create_grocery_item", args: { name: "Milk" } }] }),
      row({ role: "tool", content: '{"status":"proposed"}', tool_calls: { toolCallId: "c1", name: "create_grocery_item" } }),
      row({ role: "assistant", content: "Proposed." }),
    ]);
    expect(history).toEqual([
      { role: "user", content: "add milk" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "create_grocery_item", args: { name: "Milk" } }] },
      { role: "tool", toolCallId: "c1", name: "create_grocery_item", content: '{"status":"proposed"}' },
      { role: "assistant", content: "Proposed." },
    ]);
  });
});

describe("toMessage", () => {
  const names = new Map([["u1", "Guy"]]);
  it("hides tool output and tool-call steps", () => {
    expect(toMessage(row({ role: "tool" }), names)).toBeNull();
    expect(toMessage(row({ role: "assistant", content: "", tool_calls: [{ id: "c" }] }), names)).toBeNull();
  });

  it("names the author and summarises a proposal", () => {
    expect(toMessage(row({ content: "hi" }), names)?.author).toBe("Guy");
    const m = toMessage(
      row({
        role: "assistant",
        content: "Want me to add milk?",
        proposal: { items: [{ toolCallId: "c1", tool: "create_grocery_item", module: "groceries", args: { name: "Milk" } }] },
        proposal_state: "pending",
      }),
      names
    );
    expect(m?.proposal).toEqual({
      state: "pending",
      items: [{ tool: "create_grocery_item", module: "groceries", args: { name: "Milk" }, summary: 'Add "Milk" to Groceries' }],
    });
  });
});

describe("budgetFor", () => {
  const usage = [
    { user_id: "u1", key_source: "server" as const, cost_micros: 1_500_000 },
    { user_id: "u2", key_source: "household" as const, cost_micros: 600_000 },
  ];

  it("is ok with the permissive defaults", () => {
    expect(budgetFor(usage, "u1", DEFAULT_ASSISTANT_SETTINGS, null, "unlimited", "server")).toEqual({ status: "ok", action: "proceed" });
  });

  it("applies the household budget and the person's allowance", () => {
    const settings = { ...DEFAULT_ASSISTANT_SETTINGS, monthlyBudgetCents: 200, atLimit: "cheap" as const };
    expect(budgetFor(usage, "u1", settings, null, "unlimited", "server")).toEqual({ status: "over", action: "cheap" });
    expect(budgetFor(usage, "u2", { ...DEFAULT_ASSISTANT_SETTINGS, atLimit: "stop" }, 50, "unlimited", "server")).toEqual({
      status: "over",
      action: "stop",
    });
  });

  it("stops at the Plus allowance only on Rooftap's key", () => {
    const spent = [{ user_id: "u1", key_source: "server" as const, cost_micros: PLUS_ASSISTANT_ALLOWANCE_CENTS * 10_000 }];
    expect(budgetFor(spent, "u1", DEFAULT_ASSISTANT_SETTINGS, null, "allowance", "server").action).toBe("stop");
    expect(budgetFor(spent, "u1", DEFAULT_ASSISTANT_SETTINGS, null, "allowance", "household").action).toBe("proceed");
  });
});

describe("turnCost and billing", () => {
  it("prices listed models, makes local ones free and falls back for unknown cloud ones", () => {
    expect(turnCost({ free: false }, "gemini-2.5-flash-lite", 4000, 300)).toBe(520);
    expect(turnCost({ free: true }, "qwen3:14b", 4000, 300)).toBe(0);
    expect(turnCost({ free: false }, "mystery", 1_000_000, 0)).toBe(500_000);
  });

  it("treats billing as off unless the server says on", () => {
    vi.stubEnv("ROOFTAP_BILLING", "");
    expect(billingMode()).toBe("off");
    vi.stubEnv("ROOFTAP_BILLING", "on");
    expect(billingMode()).toBe("on");
    vi.unstubAllEnvs();
  });
});
