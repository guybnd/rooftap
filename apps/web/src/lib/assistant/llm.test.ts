import { describe, expect, it, vi } from "vitest";
import { anthropicClient, openAIClient, portableSchema, toAnthropicMessages, toOpenAIMessages, type ChatMessage } from "./llm";

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
