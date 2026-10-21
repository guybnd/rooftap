import { describe, expect, it, vi } from "vitest";
import { ANSWER_NOW_NOTE, MAX_TOOL_RESULT_CHARS, OUT_OF_TIME_REPLY, STEP_LIMIT_REPLY, TurnTimeoutError, executeProposals, failureReason, runAssistantTurn } from "./engine";
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

describe("runAssistantTurn against the clock", () => {
  it("asks for an answer once time is short and runs no more tools", async () => {
    const lookup = tool("get_tasks", "run");
    const llm = scripted({ toolCalls: [{ id: "1", name: "get_tasks", args: {} }] });
    const r = await runAssistantTurn({ ...base, llm, tools: [lookup], deadline: { answerBy: Date.now() - 1, giveUpAt: Date.now() + 10_000 } });
    expect(llm.calls[0].system).toContain(ANSWER_NOW_NOTE);
    expect(lookup.run).not.toHaveBeenCalled();
    expect(r.reply).toBe(OUT_OF_TIME_REPLY);
  });

  it("gives up on a model call still running at the limit", async () => {
    const llm = (() => new Promise(() => {})) as unknown as Parameters<typeof runAssistantTurn>[0]["llm"];
    await expect(
      runAssistantTurn({ ...base, llm, tools: [], deadline: { answerBy: Date.now() + 5, giveUpAt: Date.now() + 10 } })
    ).rejects.toBeInstanceOf(TurnTimeoutError);
  });
});

describe("runAssistantTurn", () => {
  it("runs a step's lookups side by side, changes after them in order, and times each", async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number, lookup: boolean): AssistantTool => ({
      ...tool(name, "run"),
      lookup,
      run: vi.fn(async () => {
        order.push(`start ${name}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end ${name}`);
        return { content: [{ type: "text" as const, text: name }] };
      }),
    });
    const llm = scripted(
      {
        toolCalls: [
          { id: "1", name: "a", args: {} },
          { id: "2", name: "w", args: {} },
          { id: "3", name: "b", args: {} },
        ],
      },
      { text: "Done." }
    );
    const r = await runAssistantTurn({ ...base, llm, tools: [slow("a", 20, true), slow("w", 1, false), slow("b", 5, true)] });
    expect(order.slice(0, 2)).toEqual(["start a", "start b"]);
    expect(order.slice(-2)).toEqual(["start w", "end w"]);
    // The model still sees the results in the order it asked.
    expect(r.messages.filter((m) => m.role === "tool").map((m) => m.content)).toEqual(["a", "w", "b"]);
    expect(r.timing.llmMs).toHaveLength(2);
    expect(r.timing.tools.map((t) => t.tool).sort()).toEqual(["a", "b", "w"]);
  });

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

describe("failureReason", () => {
  it("pulls the error out of a tool's JSON and keeps it short", () => {
    expect(failureReason('{"error":"MatchFailedError: no entity named livingroom light."}')).toBe("MatchFailedError: no entity named livingroom light");
    expect(failureReason("Service   not\nfound")).toBe("Service not found");
    expect(failureReason("x".repeat(300))).toHaveLength(160);
  });
});

describe("a step that only made changes", () => {
  const change = (): AssistantTool => ({ ...tool("add_item", "run"), lookup: false });

  it("answers with the line it wrote alongside them, without another model call", async () => {
    const llm = scripted({ text: "Added milk to the list.", toolCalls: [{ id: "1", name: "add_item", args: {} }] });
    const r = await runAssistantTurn({ ...base, llm, tools: [change()] });
    expect(llm.calls).toHaveLength(1);
    expect(r.reply).toBe("Added milk to the list.");
    expect(r.messages.map((m) => [m.role, m.content])).toEqual([
      ["assistant", ""],
      ["tool", '{"ok":true}'],
      ["assistant", "Added milk to the list."],
    ]);
  });

  it("goes back to the model when a change failed, was held, or came with a lookup", async () => {
    const failing: AssistantTool = { ...change(), run: vi.fn(async () => ({ content: [{ type: "text" as const, text: "no" }], isError: true })) };
    const say = { text: "Added milk.", toolCalls: [{ id: "1", name: "add_item", args: {} }] };
    for (const tools of [[failing], [{ ...change(), gate: "propose" as const }]]) {
      const llm = scripted(say, { text: "Sorry." });
      expect((await runAssistantTurn({ ...base, llm, tools })).reply).toBe("Sorry.");
    }
    const llm = scripted({ ...say, toolCalls: [...say.toolCalls, { id: "2", name: "get_tasks", args: {} }] }, { text: "Done, and here's the list." });
    const r = await runAssistantTurn({ ...base, llm, tools: [change(), { ...tool("get_tasks", "run"), lookup: true }] });
    expect(llm.calls).toHaveLength(2);
    expect(r.reply).toBe("Done, and here's the list.");
  });
});

describe("runAssistantTurn streaming (HOUP-509)", () => {
  it("streams each step's text without memory markers, and says what the tools are doing", async () => {
    let call = 0;
    const llm: LlmClient = async (req) => {
      call++;
      if (call === 1) {
        req.onText?.("Let me look.");
        return { text: "Let me look.", toolCalls: [{ id: "1", name: "get_grocery_items", args: {} }], inputTokens: 1, outputTokens: 1 };
      }
      for (const piece of ["You need milk.", " <remem", "ber>likes oat milk</remember>", " Anything else?"]) req.onText?.(piece);
      return { text: "You need milk. <remember>likes oat milk</remember> Anything else?", toolCalls: [], inputTokens: 1, outputTokens: 1 };
    };
    const lookup = { ...tool("get_grocery_items", "run"), lookup: true };
    const events: unknown[] = [];
    const r = await runAssistantTurn({ ...base, llm, tools: [lookup], onStream: (e) => events.push(e) });
    expect(events.slice(0, 3)).toEqual([{ type: "text", text: "Let me look." }, { type: "status", text: "Checking Groceries" }, { type: "step" }]);
    const streamed = (events.slice(3) as { type: string; text: string }[]).map((e) => (e.type === "text" ? e.text : "?")).join("");
    expect(streamed).toBe("You need milk.  Anything else?");
    expect(r.reply).toBe("You need milk.  Anything else?");
    expect(r.memories).toEqual(["likes oat milk"]);
  });

  it("names a change while it runs", async () => {
    const llm = scripted({ text: "Added.", toolCalls: [{ id: "1", name: "create_grocery_item", args: { name: "Milk" } }] });
    const events: unknown[] = [];
    await runAssistantTurn({ ...base, llm: (req) => llm({ ...req, onText: undefined }), tools: [tool("create_grocery_item", "run")], onStream: (e) => events.push(e) });
    expect(events).toContainEqual({ type: "status", text: 'Add "Milk" to Groceries' });
  });
});
