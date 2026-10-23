import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/session", () => ({ getSessionUser: vi.fn() }));

import { DEFAULT_ASSISTANT_SETTINGS, PLUS_ASSISTANT_ALLOWANCE_CENTS } from "@homeup/core";
import { FOLD_BATCH, billingMode, budgetFor, foldOlderMessages, toHistory, toMessage, turnCost, type AssistantContext } from "./service";
import type { LlmClient } from "./llm";

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

describe("toHistory with steps read back out of order", () => {
  const call = (id: string) => ({ id, name: "get_budget_summary", args: {} });
  it("puts each tool result after the step that called it", () => {
    // One insert stamped the whole turn alike, so the result came back first.
    const history = toHistory([
      row({ role: "user", content: "costs in October?" }),
      row({ role: "tool", content: "{}", tool_calls: { toolCallId: "t1", name: "get_budget_summary" } }),
      row({ role: "assistant", content: "", tool_calls: [call("t1")] }),
      row({ role: "assistant", content: "Here's October." }),
      row({ role: "user", content: "and groceries?" }),
    ]);
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "user"]);
    expect(history[2]).toMatchObject({ role: "tool", toolCallId: "t1" });
  });

  it("drops a call with no result and a result with no call", () => {
    const history = toHistory([
      row({ role: "user", content: "hi" }),
      row({ role: "assistant", content: "Looking.", tool_calls: [call("gone")] }),
      row({ role: "tool", content: "{}", tool_calls: { toolCallId: "stray", name: "get_tasks" } }),
      row({ role: "assistant", content: "Done." }),
    ]);
    expect(history).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Looking." },
      { role: "assistant", content: "Done." },
    ]);
  });

  it("keeps the newest messages from a user message on", () => {
    const history = toHistory(
      [
        row({ role: "user", content: "first" }),
        row({ role: "assistant", content: "", tool_calls: [call("t1")] }),
        row({ role: "tool", content: "{}", tool_calls: { toolCallId: "t1", name: "get_budget_summary" } }),
        row({ role: "assistant", content: "One." }),
        row({ role: "user", content: "second" }),
        row({ role: "assistant", content: "Two." }),
      ],
      undefined,
      4
    );
    expect(history).toEqual([
      { role: "user", content: "second" },
      { role: "assistant", content: "Two." },
    ]);
  });
});

describe("toHistory in the household thread", () => {
  it("names each member and folds their chat into one message before the ask", () => {
    const names = new Map([
      ["u1", "Guy"],
      ["u2", "Noa"],
    ]);
    const history = toHistory(
      [
        row({ role: "user", user_id: "u1", content: "pizza tonight?" }),
        row({ role: "user", user_id: "u2", content: "yes" }),
        row({ role: "user", user_id: "u1", content: "@Rooftap add dough to the list" }),
        row({ role: "assistant", content: "Added." }),
      ],
      names
    );
    expect(history).toEqual([
      { role: "user", content: "Guy: pizza tonight?\nNoa: yes\nGuy: @Rooftap add dough to the list" },
      { role: "assistant", content: "Added." },
    ]);
  });
});

describe("toMessage", () => {
  const names = new Map([["u1", "Guy"]]);
  it("hides tool output and tool-call steps", () => {
    expect(toMessage(row({ role: "tool" }), names)).toBeNull();
    expect(toMessage(row({ role: "assistant", content: "", tool_calls: [{ id: "c" }] }), names)).toBeNull();
  });

  it("marks which messages the viewer wrote", () => {
    expect(toMessage(row({ content: "hi", user_id: "u1" }), names, "u1")?.mine).toBe(true);
    expect(toMessage(row({ content: "hi", user_id: "u1" }), names, "u2")?.mine).toBe(false);
    expect(toMessage(row({ role: "assistant", content: "ok" }), names, "u1")?.mine).toBe(false);
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

describe("foldOlderMessages", () => {
  // 30 messages a minute apart; the newest `window` stay word for word.
  const messages = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `message ${i}`,
    user_id: "u1",
    created_at: new Date(Date.UTC(2026, 9, 21, 0, i)).toISOString(),
  }));

  function fakeAdmin() {
    const updates: Record<string, unknown>[] = [];
    const rpc = vi.fn(async () => ({ error: null }));
    const from = (table: string) => {
      let rows = table === "assistant_messages" ? [...messages] : [];
      let range: [number, number] | null = null;
      let limit = Infinity;
      const q = {
        select: () => q,
        eq: () => q,
        in: (_k: string, vs: string[]) => ((rows = rows.filter((r) => vs.includes(r.role))), q),
        lt: (_k: string, v: string) => ((rows = rows.filter((r) => r.created_at < v)), q),
        gt: (_k: string, v: string) => ((rows = rows.filter((r) => r.created_at > v)), q),
        order: (_k: string, { ascending }: { ascending: boolean }) => ((rows = [...rows].sort((a, b) => (ascending ? 1 : -1) * a.created_at.localeCompare(b.created_at))), q),
        range: (a: number, b: number) => ((range = [a, b]), q),
        limit: (n: number) => ((limit = n), q),
        maybeSingle: async () => ({ data: range ? rows[range[0]] ?? null : rows[0] ?? null }),
        update: (patch: Record<string, unknown>) => (updates.push(patch), { eq: async () => ({ error: null }) }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows.slice(0, limit) }),
      };
      return q;
    };
    return { admin: { from, rpc }, updates, rpc };
  }

  const llm: LlmClient = vi.fn(async () => ({ text: "Planned the Sunday BBQ.", toolCalls: [], inputTokens: 100, outputTokens: 20 }));
  const conversation = { id: "c", group_id: "g", owner_id: "u1", kind: "chat" as const, title: null, pinned: false, summary: null, summary_through: null, last_active_at: "", closes_at: null };
  const opts = { llm, model: "m", window: 12, brain: { free: true, keySource: "server" as const }, feature: "chat", names: new Map([["u1", "Noa"]]) };

  it("folds what left the window into the summary and moves the marker", async () => {
    const { admin, updates, rpc } = fakeAdmin();
    await foldOlderMessages({ admin, userId: "u1", groupId: "g" } as unknown as AssistantContext, conversation, opts);
    expect(updates).toEqual([{ summary: "Planned the Sunday BBQ.", summary_through: messages[17].created_at }]);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("waits for a full batch, and skips a server without the column", async () => {
    const { admin, updates } = fakeAdmin();
    const ctx = { admin, userId: "u1", groupId: "g" } as unknown as AssistantContext;
    await foldOlderMessages(ctx, { ...conversation, summary_through: messages[30 - 12 - FOLD_BATCH].created_at }, opts);
    await foldOlderMessages(ctx, { ...conversation, summary_through: undefined }, opts);
    expect(updates).toEqual([]);
  });
});
