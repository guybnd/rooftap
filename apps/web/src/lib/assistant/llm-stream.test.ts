import { beforeEach, describe, expect, it, vi } from "vitest";
import { anthropicClient, forgetStreamFailures, openAIClient, withFallbackModel, type LlmRequest } from "./llm";

// HOUP-509: streamed steps, and the way back for servers that can't stream.

const req = (onText?: (d: string) => void): LlmRequest => ({
  model: "m",
  system: "s",
  messages: [{ role: "user", content: "what's on?" }],
  tools: [],
  ...(onText ? { onText } : {}),
});

function sse(events: unknown[]): Response {
  return new Response(events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

function completion(content: string | null, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: "r",
      object: "chat.completion",
      created: 0,
      model: "m",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, ...extra } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }),
    { headers: { "content-type": "application/json" } }
  );
}

const chunk = (delta: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
  id: "r",
  object: "chat.completion.chunk",
  created: 0,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: null }],
  ...more,
});

function bodyOf(fetchImpl: ReturnType<typeof vi.fn>, call: number) {
  const init = (fetchImpl.mock.calls[call] as unknown as [string, RequestInit])[1];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => forgetStreamFailures());

describe("openAIClient streaming", () => {
  it("hands over text as it arrives and adds up a streamed answer", async () => {
    const fetchImpl = vi.fn(async () =>
      sse([
        chunk({ role: "assistant", content: "Two " }),
        chunk({ content: "things today." }),
        { id: "r", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 40, completion_tokens: 5 } },
        "[DONE]",
      ])
    );
    const deltas: string[] = [];
    const step = await openAIClient({ wire: "openai", apiKey: "k" }, fetchImpl as unknown as typeof fetch)(req((d) => deltas.push(d)));
    expect(deltas).toEqual(["Two ", "things today."]);
    expect(step).toEqual({ text: "Two things today.", toolCalls: [], inputTokens: 40, outputTokens: 5 });
    expect(bodyOf(fetchImpl, 0)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it("puts tool calls back together from their pieces, keeping Gemini's signature", async () => {
    const signature = { google: { thought_signature: "CvcQ" } };
    const fetchImpl = vi.fn(async () =>
      sse([
        chunk({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "get_tasks", arguments: '{"do' }, extra_content: signature }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'ne":false}' } }] }),
        chunk({ tool_calls: [{ index: 1, id: "c2", type: "function", function: { name: "get_events", arguments: "{}" } }] }),
        "[DONE]",
      ])
    );
    const step = await openAIClient({ wire: "openai", apiKey: "k" }, fetchImpl as unknown as typeof fetch)(req(() => {}));
    expect(step.toolCalls).toEqual([
      { id: "c1", name: "get_tasks", args: { done: false }, extra: signature },
      { id: "c2", name: "get_events", args: {} },
    ]);
  });

  it("reads a server that answers a stream request with plain JSON, then stops asking it to stream", async () => {
    const fetchImpl = vi.fn(async () => completion("Hello."));
    const client = openAIClient({ wire: "openai", apiKey: "k", baseURL: "http://ollama:11434/v1" }, fetchImpl as unknown as typeof fetch);
    const deltas: string[] = [];
    const step = await client(req((d) => deltas.push(d)));
    expect(step.text).toBe("Hello.");
    expect(deltas).toEqual(["Hello."]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchImpl, 1).stream).toBeUndefined();

    await client(req(() => {}));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(bodyOf(fetchImpl, 2).stream).toBeUndefined();
  });

  it("asks again without streaming when the server rejects it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "stream is not supported" } }), { status: 400, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(completion("Fine."));
    const step = await openAIClient({ wire: "openai", apiKey: "k", baseURL: "http://lm:1234/v1" }, fetchImpl as unknown as typeof fetch)(req(() => {}));
    expect(step.text).toBe("Fine.");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("asks again without streaming when a streamed tool call comes in garbled", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(sse([chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "get_tasks", arguments: '{"done":' } }] }), "[DONE]"]))
      .mockResolvedValueOnce(
        completion(null, { tool_calls: [{ id: "c1", type: "function", function: { name: "get_tasks", arguments: '{"done":true}' } }] })
      );
    const step = await openAIClient({ wire: "openai", apiKey: "k", baseURL: "http://odd:1/v1" }, fetchImpl as unknown as typeof fetch)(req(() => {}));
    expect(step.toolCalls).toEqual([{ id: "c1", name: "get_tasks", args: { done: true } }]);
  });

  it("never asks a provider switched off to stream", async () => {
    const fetchImpl = vi.fn(async () => completion("Hi."));
    const deltas: string[] = [];
    await openAIClient({ wire: "openai", apiKey: "k", stream: false }, fetchImpl as unknown as typeof fetch)(req((d) => deltas.push(d)));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchImpl, 0).stream).toBeUndefined();
    expect(deltas).toEqual(["Hi."]);
  });

  it("doesn't stream when nobody is listening", async () => {
    const fetchImpl = vi.fn(async () => completion("Hi."));
    await openAIClient({ wire: "openai", apiKey: "k" }, fetchImpl as unknown as typeof fetch)(req());
    expect(bodyOf(fetchImpl, 0).stream).toBeUndefined();
  });
});

describe("anthropicClient streaming", () => {
  it("hands over text, puts tool input together and counts cached tokens", async () => {
    const fetchImpl = vi.fn(async () =>
      sse([
        { type: "message_start", message: { usage: { input_tokens: 20, cache_read_input_tokens: 100, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Checking " } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "now." } },
        { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "get_tasks", input: {} } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"done":' } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "false}" } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } },
        { type: "message_stop" },
      ])
    );
    const deltas: string[] = [];
    const step = await anthropicClient({ wire: "anthropic", apiKey: "k" }, fetchImpl as unknown as typeof fetch)(req((d) => deltas.push(d)));
    expect(deltas).toEqual(["Checking ", "now."]);
    expect(step).toEqual({ text: "Checking now.", toolCalls: [{ id: "t1", name: "get_tasks", args: { done: false } }], inputTokens: 120, outputTokens: 12 });
    expect(bodyOf(fetchImpl, 0).stream).toBe(true);
  });

  it("reads a proxy that ignored the stream request", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: {} }), { headers: { "content-type": "application/json" } }));
    const deltas: string[] = [];
    const step = await anthropicClient({ wire: "anthropic", apiKey: "k" }, fetchImpl as unknown as typeof fetch)(req((d) => deltas.push(d)));
    expect(step.text).toBe("ok");
    expect(deltas).toEqual(["ok"]);
  });

  it("fails an overloaded stream as busy, so the model fallback can take it", async () => {
    const fetchImpl = vi.fn(async () => sse([{ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]));
    await expect(anthropicClient({ wire: "anthropic", apiKey: "k" }, fetchImpl as unknown as typeof fetch)(req(() => {}))).rejects.toThrow(/overloaded/i);
  });
});

describe("withFallbackModel while streaming", () => {
  it("doesn't start over on another model once text has gone out", async () => {
    const first = vi.fn(async (r: LlmRequest) => {
      r.onText?.("Half an ans");
      throw Object.assign(new Error("overloaded"), { status: 503 });
    });
    const llm = withFallbackModel(first, "backup");
    await expect(llm(req(() => {}))).rejects.toThrow("overloaded");
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("still moves to the fallback when nothing went out yet", async () => {
    const first = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("overloaded"), { status: 503 }))
      .mockResolvedValueOnce({ text: "ok", toolCalls: [], inputTokens: 1, outputTokens: 1 });
    const llm = withFallbackModel(first, "backup");
    expect((await llm(req(() => {}))).text).toBe("ok");
    expect(llm.model()).toBe("backup");
  });
});
