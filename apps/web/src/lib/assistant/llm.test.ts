import { describe, expect, it, vi } from "vitest";
import { anthropicClient, isProviderBusy, openAIClient, portableSchema, toAnthropicMessages, toOpenAIMessages, withFallbackModel, type ChatMessage } from "./llm";

const convo: ChatMessage[] = [
  { role: "user", content: "add milk" },
  { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "create_grocery_item", args: { name: "Milk" } }] },
  { role: "tool", toolCallId: "c1", name: "create_grocery_item", content: '{"status":"proposed"}' },
];

describe("wire formats", () => {
  it("maps to OpenAI chat messages with a system message and tool calls", () => {
    const out = toOpenAIMessages("sys", convo);
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect(out[2]).toMatchObject({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "create_grocery_item", arguments: '{"name":"Milk"}' } }],
    });
    expect(out[3]).toEqual({ role: "tool", tool_call_id: "c1", content: '{"status":"proposed"}' });
  });

  it("keeps Gemini's thought signature on a tool call and sends it back", async () => {
    const signature = { google: { thought_signature: "CvcQAdHN" } };
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "r",
          object: "chat.completion",
          created: 0,
          model: "m",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{ id: "c9", type: "function", function: { name: "get_tasks", arguments: "{}" }, extra_content: signature }],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
        { headers: { "content-type": "application/json" } }
      )
    );
    const step = await openAIClient({ wire: "openai", apiKey: "k" }, fetchImpl as unknown as typeof fetch)({
      model: "m",
      system: "s",
      messages: [{ role: "user", content: "what's on?" }],
      tools: [],
    });
    expect(step.toolCalls).toEqual([{ id: "c9", name: "get_tasks", args: {}, extra: signature }]);
    const replay = toOpenAIMessages("s", [{ role: "assistant", content: "", toolCalls: step.toolCalls }]);
    expect(replay[1]).toMatchObject({ tool_calls: [{ id: "c9", extra_content: signature }] });
  });

  it("maps to Anthropic messages with tool results in user turns, merging same-role turns", () => {
    const out = toAnthropicMessages([...convo, { role: "user", content: "thanks" }]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out[1].content).toEqual([{ type: "tool_use", id: "c1", name: "create_grocery_item", input: { name: "Milk" } }]);
    expect(out[2].content).toEqual([
      { type: "tool_result", tool_use_id: "c1", content: '{"status":"proposed"}' },
      { type: "text", text: "thanks" },
    ]);
  });

  it("reads Anthropic text, tool calls and usage", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [
            { type: "text", text: "Checking." },
            { type: "tool_use", id: "t1", name: "get_tasks", input: { done: false } },
          ],
          usage: { input_tokens: 120, output_tokens: 8 },
        })
      )
    );
    const step = await anthropicClient({ wire: "anthropic", apiKey: "k" }, fetchImpl as unknown as typeof fetch)({
      model: "m",
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    expect(step).toEqual({
      text: "Checking.",
      toolCalls: [{ id: "t1", name: "get_tasks", args: { done: false } }],
      inputTokens: 120,
      outputTokens: 8,
    });
  });
});

describe("anthropicClient on Haiku 5.5", () => {
  it("turns thinking off, which it has on by default", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: {} })));
    await anthropicClient({ wire: "anthropic", apiKey: "k" }, fetchImpl as unknown as typeof fetch)({
      model: "claude-haiku-5-5",
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.thinking).toEqual({ type: "disabled" });
  });
});

describe("Anthropic prompt caching", () => {
  it("marks the tool list and the end of the conversation, and counts cached tokens", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "ok" }],
            usage: { input_tokens: 20, cache_creation_input_tokens: 300, cache_read_input_tokens: 2000, output_tokens: 5 },
          })
        )
    );
    const step = await anthropicClient({ wire: "anthropic", apiKey: "k" }, fetchImpl as unknown as typeof fetch)({
      model: "claude-haiku-5-5",
      system: "s",
      messages: [
        { role: "user", content: "switch the light on" },
        { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "on", args: {} }] },
        { role: "tool", toolCallId: "t1", name: "on", content: "done" },
      ],
      tools: [
        { name: "a", description: "a", parameters: { type: "object" } },
        { name: "on", description: "on", parameters: { type: "object" } },
      ],
    });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.tools.map((t: { cache_control?: unknown }) => t.cache_control ?? null)).toEqual([null, { type: "ephemeral" }]);
    const last = body.messages.at(-1);
    expect(last.content.at(-1)).toEqual({ type: "tool_result", tool_use_id: "t1", content: "done", cache_control: { type: "ephemeral" } });
    expect(body.messages[0].content[0].cache_control).toBeUndefined();
    expect(step.inputTokens).toBe(2320);
  });
});

describe("portableSchema", () => {
  it("rewrites zod's JSON Schema into the subset Gemini accepts", () => {
    expect(
      portableSchema({
        type: "object",
        additionalProperties: false,
        required: ["days"],
        properties: {
          days: { type: "integer", exclusiveMinimum: 0, maximum: 90 },
          note: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
          tags: { type: "array", items: { type: "object", additionalProperties: false, properties: { additionalProperties: { type: "string" } } } },
        },
      })
    ).toEqual({
      type: "object",
      required: ["days"],
      properties: {
        days: { type: "integer", minimum: 1, maximum: 90 },
        note: { type: "string", minLength: 1, nullable: true },
        tags: { type: "array", items: { type: "object", properties: { additionalProperties: { type: "string" } } } },
      },
    });
  });
});

describe("withFallbackModel", () => {
  const req = { model: "fast", system: "s", messages: [], tools: [] };
  const ok = { text: "hi", toolCalls: [], inputTokens: 1, outputTokens: 1 };

  it("moves to the other model when the first is busy, and stays there", async () => {
    const seen: string[] = [];
    const base = vi.fn(async (r: { model: string }) => {
      seen.push(r.model);
      if (r.model === "fast") throw Object.assign(new Error("503 status code (no body)"), { status: 503 });
      return ok;
    });
    const llm = withFallbackModel(base, "steady");
    await llm(req);
    await llm(req);
    expect(seen).toEqual(["fast", "steady", "steady"]);
    expect(llm.model()).toBe("steady");
  });

  it("doesn't hide a bad key or request behind the fallback", async () => {
    const llm = withFallbackModel(vi.fn(async () => Promise.reject(Object.assign(new Error("bad key"), { status: 401 }))), "steady");
    await expect(llm(req)).rejects.toThrow("bad key");
  });

  it("looks up another provider only when the first is busy", async () => {
    const busy = vi.fn(async () => Promise.reject(Object.assign(new Error("503 status code (no body)"), { status: 503 })));
    const other = vi.fn(async () => ok);
    const find = vi.fn(async () => ({ llm: other, model: "gpt" }));
    const llm = withFallbackModel(busy, find);
    await llm(req);
    expect(find).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt" }));
    expect(llm.model()).toBe("gpt");
  });

  it("knows a busy provider from its message too", () => {
    expect(isProviderBusy(new Error("Anthropic request failed (529): overloaded"))).toBe(true);
    expect(isProviderBusy(new Error("503 status code (no body)"))).toBe(true);
    expect(isProviderBusy(new Error("Anthropic request failed (400): bad"))).toBe(false);
  });
});
