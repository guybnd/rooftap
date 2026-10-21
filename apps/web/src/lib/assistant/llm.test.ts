import { describe, expect, it, vi } from "vitest";
import { anthropicClient, toAnthropicMessages, toOpenAIMessages, type ChatMessage } from "./llm";

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
