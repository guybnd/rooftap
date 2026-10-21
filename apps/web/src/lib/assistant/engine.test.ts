import { describe, expect, it, vi } from "vitest";
import { MAX_TOOL_RESULT_CHARS, STEP_LIMIT_REPLY, executeProposals, runAssistantTurn } from "./engine";
import type { LlmClient, LlmStep } from "./llm";
import type { AssistantTool } from "./tools";

function scripted(...steps: Partial<LlmStep>[]): LlmClient & { calls: Parameters<LlmClient>[0][] } {
  const calls: Parameters<LlmClient>[0][] = [];
  const fn = (async (req) => {
    calls.push(structuredClone(req));
    const s = steps[Math.min(calls.length - 1, steps.length - 1)];
    return { text: "", toolCalls: [], inputTokens: 100, outputTokens: 10, ...s };
  }) as LlmClient & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

function tool(name: string, gate: AssistantTool["gate"], text = '{"ok":true}'): AssistantTool {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    module: "groceries",
    gate,
    run: vi.fn(async () => ({ content: [{ type: "text" as const, text }] })),
  };
}

const base = { model: "m", system: "sys", history: [], userText: "add milk" };

describe("runAssistantTurn", () => {
  it("answers directly when the model calls no tools, and strips memories", async () => {
    const llm = scripted({ text: "Sure.<remember>Noa is vegetarian</remember>" });
    const r = await runAssistantTurn({ ...base, llm, tools: [] });
    expect(r.reply).toBe("Sure.");
    expect(r.memories).toEqual(["Noa is vegetarian"]);
    expect(r.steps).toBe(1);
    expect(llm.calls[0].messages).toEqual([{ role: "user", content: "add milk" }]);
  });

  it("runs a tool, feeds the result back and adds up tokens", async () => {
    const get = tool("get_grocery_items", "run", '[{"name":"Eggs"}]');
    const llm = scripted({ toolCalls: [{ id: "c1", name: "get_grocery_items", args: {} }] }, { text: "You need eggs." });
    const r = await runAssistantTurn({ ...base, llm, tools: [get] });
    expect(get.run).toHaveBeenCalledOnce();
    expect(r.reply).toBe("You need eggs.");
    expect(r.inputTokens).toBe(200);
    expect(r.ran).toEqual([{ tool: "get_grocery_items", args: {}, ok: true }]);
    expect(llm.calls[1].messages.at(-1)).toEqual({ role: "tool", toolCallId: "c1", name: "get_grocery_items", content: '[{"name":"Eggs"}]' });
  });

  it("holds a proposed change instead of running it", async () => {
    const create = tool("create_grocery_item", "propose");
    const llm = scripted(
      { toolCalls: [{ id: "c1", name: "create_grocery_item", args: { name: "Milk" } }] },
      { text: "I've proposed adding milk." }
    );
    const r = await runAssistantTurn({ ...base, llm, tools: [create] });
    expect(create.run).not.toHaveBeenCalled();
    expect(r.proposals).toEqual([{ toolCallId: "c1", tool: "create_grocery_item", module: "groceries", args: { name: "Milk" } }]);
    expect(llm.calls[1].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("proposed") });
  });

  it("tells the model about a tool it does not have", async () => {
    const llm = scripted({ toolCalls: [{ id: "c1", name: "delete_task", args: {} }] }, { text: "Can't do that." });
    const r = await runAssistantTurn({ ...base, llm, tools: [] });
    expect(llm.calls[1].messages.at(-1)).toMatchObject({ content: expect.stringContaining("No tool called delete_task") });
    expect(r.reply).toBe("Can't do that.");
  });

  it("caps long tool output", async () => {
    const big = tool("get_tasks", "run", "x".repeat(MAX_TOOL_RESULT_CHARS + 50));
    const llm = scripted({ toolCalls: [{ id: "c1", name: "get_tasks", args: {} }] }, { text: "ok" });
    await runAssistantTurn({ ...base, llm, tools: [big] });
    const sent = llm.calls[1].messages.at(-1) as { content: string };
    expect(sent.content.length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 20);
  });

  it("stops at the step cap", async () => {
    const get = tool("get_tasks", "run");
    const llm = scripted({ toolCalls: [{ id: "c", name: "get_tasks", args: {} }] });
    const r = await runAssistantTurn({ ...base, llm, tools: [get], maxSteps: 3 });
    expect(r.steps).toBe(3);
    expect(r.reply).toBe(STEP_LIMIT_REPLY);
  });
});

describe("executeProposals", () => {
  it("runs confirmed proposals and refuses ones no longer offered", async () => {
    const create = tool("create_grocery_item", "propose");
    const out = await executeProposals(
      [
        { toolCallId: "c1", tool: "create_grocery_item", module: "groceries", args: { name: "Milk" } },
        { toolCallId: "c2", tool: "delete_task", module: "household", args: {} },
      ],
      [create]
    );
    expect(create.run).toHaveBeenCalledWith({ name: "Milk" });
    expect(out.map((o) => o.ok)).toEqual([true, false]);
  });
});
