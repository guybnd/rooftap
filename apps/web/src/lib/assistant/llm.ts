import OpenAI from "openai";
import { createSseReader } from "@homeup/core";

// HOUP-442: one chat format for the assistant's tool loop and the two wire
// formats behind it. OpenAI's chat completions cover OpenAI, OpenRouter,
// Gemini (through its OpenAI-compatible endpoint) and any local server that
// speaks the same API (Ollama, LM Studio); Anthropic gets its own adapter.
// Each call is one step: the model either answers or asks for tool calls,
// and engine.ts runs the loop.

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * Provider data that must go back with the call on the next step, as
   * received. Gemini 3 puts its thought signature here
   * (`{google: {thought_signature}}`) and rejects a follow-up step whose
   * tool call lacks it (400).
   */
  extra?: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (an object schema). */
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  /**
   * Hands over the answer's text as the model writes it (HOUP-509). Only a
   * wish: a provider that can't stream answers the usual way, and the text
   * then arrives in one piece.
   */
  onText?: (delta: string) => void;
}

export interface LlmStep {
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
}

export type LlmClient = (req: LlmRequest) => Promise<LlmStep>;

export type LlmWire = "openai" | "anthropic";

export interface LlmConnection {
  wire: LlmWire;
  apiKey: string;
  /** For the openai wire: OpenRouter, Gemini's compatible endpoint, or a local server. */
  baseURL?: string;
  /** false: never ask this provider to stream (the operator's "Stream replies" switch, off). */
  stream?: boolean;
}

// ── Streaming, with a way back ────────────────────────────────────────────
//
// Streaming is an upgrade, never a requirement: a local or proxy server may
// reject `stream: true`, ignore it and answer with plain JSON, or garble
// tool calls in pieces. A step that fails to stream before any text went
// out is asked again the usual way, and once that works the provider is
// remembered as one that can't stream, so later steps skip the attempt.

const cannotStream = new Set<string>();

function streamKey(conn: LlmConnection): string {
  return `${conn.wire}:${conn.baseURL ?? "default"}`;
}

/** Forgets which providers couldn't stream (tests). */
export function forgetStreamFailures(): void {
  cannotStream.clear();
}

/** A streamed step that didn't work out and can be asked again without streaming (nothing reached the person yet). */
class NotStreamed extends Error {}

async function withStreamFallback(
  conn: LlmConnection,
  req: LlmRequest,
  streamed: (onText: (delta: string) => void, markSent: () => void) => Promise<LlmStep>,
  plain: () => Promise<LlmStep>
): Promise<LlmStep> {
  const onText = req.onText;
  const key = streamKey(conn);
  if (!onText || conn.stream === false || cannotStream.has(key)) {
    const step = await plain();
    if (onText && step.text) onText(step.text);
    return step;
  }
  let sent = false;
  try {
    return await streamed(onText, () => (sent = true));
  } catch (err) {
    // Text already on screen can't be taken back; a busy provider is the model fallback's call.
    if (sent || (!(err instanceof NotStreamed) && isProviderBusy(err))) throw err;
    console.warn(`[assistant] streaming from ${key} failed, asking without it: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
  }
  const step = await plain();
  cannotStream.add(key);
  if (step.text) onText(step.text);
  return step;
}

function parseArgs(raw: string | undefined | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

let fallbackId = 0;
function callId(id: string | undefined | null): string {
  return id && id.length > 0 ? id : `call_${Date.now().toString(36)}_${(fallbackId++).toString(36)}`;
}

// ── OpenAI wire ───────────────────────────────────────────────────────────

/**
 * Tool schemas in the subset every OpenAI-compatible server accepts. zod's
 * JSON Schema has `{type: "null"}` branches, `additionalProperties` and
 * `exclusiveMinimum`, which Gemini's compatible endpoint rejects outright
 * (the whole request fails), so: nullable unions become `nullable: true`,
 * exclusive bounds become inclusive ones, and the rest is dropped.
 */
export function portableSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(portableSchema);
  if (!schema || typeof schema !== "object") return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (key === "additionalProperties" || key === "$schema" || key === "exclusiveMaximum") continue;
    if (key === "exclusiveMinimum" && typeof value === "number") {
      out.minimum = src.type === "integer" ? Math.floor(value) + 1 : value;
      continue;
    }
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, portableSchema(v)]));
      continue;
    }
    out[key] = portableSchema(value);
  }
  if (typeof src.exclusiveMaximum === "number" && out.maximum === undefined) {
    out.maximum = src.type === "integer" ? Math.ceil(src.exclusiveMaximum) - 1 : src.exclusiveMaximum;
  }
  const union = (out.anyOf ?? out.oneOf) as Record<string, unknown>[] | undefined;
  if (Array.isArray(union)) {
    const rest = union.filter((b) => b?.type !== "null");
    if (rest.length < union.length) {
      delete out.anyOf;
      delete out.oneOf;
      if (rest.length === 1) Object.assign(out, rest[0]);
      else out.anyOf = rest;
      out.nullable = true;
    }
  }
  return out;
}

export function toOpenAIMessages(system: string, messages: ChatMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    else
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: JSON.stringify(c.args) },
                ...(c.extra ? { extra_content: c.extra } : {}),
              })),
            }
          : {}),
      });
  }
  return out;
}

/** Gemini's `extra_content` on a tool call (not in the OpenAI types), kept to send back. */
function extraContent(call: object): { extra?: Record<string, unknown> } {
  const extra = (call as { extra_content?: unknown }).extra_content;
  return extra && typeof extra === "object" && !Array.isArray(extra) ? { extra: extra as Record<string, unknown> } : {};
}

export function openAIClient(conn: LlmConnection, fetchImpl?: typeof fetch): LlmClient {
  const client = new OpenAI({
    apiKey: conn.apiKey || "not-needed",
    ...(conn.baseURL ? { baseURL: conn.baseURL } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const isGemini = !!conn.baseURL?.includes("generativelanguage.googleapis.com");
  return async (req) => {
    const params = {
      model: req.model,
      messages: toOpenAIMessages(req.system, req.messages),
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function" as const,
              function: { name: t.name, description: t.description, parameters: portableSchema(t.parameters) as Record<string, unknown> },
            })),
          }
        : {}),
      // OpenAI's reasoning models (GPT-5 on) refuse max_tokens.
      ...(/^(gpt-[5-9]|o[1-9])/.test(req.model.replace(/^openai\//, ""))
        ? { max_completion_tokens: req.maxTokens ?? 1024 }
        : { max_tokens: req.maxTokens ?? 1024 }),
      // Gemini 3 thinks before answering by default, which is most of a
      // reply's wait; household questions don't need deep thought. Only
      // Gemini gets this: other OpenAI-compatible servers may reject it.
      ...(isGemini ? { reasoning_effort: "low" as const } : {}),
    };
    const plain = async (): Promise<LlmStep> => {
      const response = await client.chat.completions.create(params);
      const message = response.choices[0]?.message;
      const toolCalls: ToolCall[] = (message?.tool_calls ?? []).flatMap((c) =>
        c.type === "function"
          ? [
              {
                id: callId(c.id),
                name: c.function.name,
                args: parseArgs(c.function.arguments),
                ...extraContent(c),
              },
            ]
          : []
      );
      return {
        text: message?.content ?? "",
        toolCalls,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };
    };
    const streamed = async (onText: (delta: string) => void, markSent: () => void): Promise<LlmStep> => {
      const stream = await client.chat.completions.create({ ...params, stream: true, stream_options: { include_usage: true } });
      let text = "";
      let chunks = 0;
      let usage: OpenAI.CompletionUsage | undefined;
      const calls: { id?: string; name: string; args: string; extra?: Record<string, unknown> }[] = [];
      for await (const chunk of stream) {
        chunks++;
        if (chunk.usage) usage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          text += delta.content;
          markSent();
          onText(delta.content);
        }
        for (const c of delta.tool_calls ?? []) {
          const slot = (calls[c.index ?? calls.length] ??= { name: "", args: "" });
          if (c.id) slot.id = c.id;
          // Most servers send the name once; some repeat it whole on every piece.
          const name = c.function?.name;
          if (name && name !== slot.name) slot.name += name;
          if (c.function?.arguments) slot.args += c.function.arguments;
          const { extra } = extraContent(c);
          if (extra) slot.extra = { ...slot.extra, ...extra };
        }
      }
      // An answer that wasn't a stream at all (plain JSON) reads as no events.
      if (chunks === 0) throw new NotStreamed("The provider didn't stream its answer.");
      const toolCalls: ToolCall[] = [];
      for (const c of calls) {
        if (!c) continue;
        let args: Record<string, unknown> = {};
        if (c.args.trim()) {
          try {
            JSON.parse(c.args);
            args = parseArgs(c.args);
          } catch {
            if (!text) throw new NotStreamed(`The streamed call to ${c.name || "a tool"} came in garbled.`);
          }
        }
        if (!c.name) {
          if (!text) throw new NotStreamed("A streamed tool call came without its name.");
          continue;
        }
        toolCalls.push({ id: callId(c.id), name: c.name, args, ...(c.extra ? { extra: c.extra } : {}) });
      }
      return { text, toolCalls, inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 };
    };
    return withStreamFallback(conn, req, streamed, plain);
  };
}

// ── Anthropic wire ────────────────────────────────────────────────────────

const EPHEMERAL = { type: "ephemeral" } as const;

type AnthropicBlock = (
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string }
) & { cache_control?: typeof EPHEMERAL };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

/** Tool results ride in user turns, and consecutive same-role turns merge. */
export function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  const push = (role: AnthropicMessage["role"], blocks: AnthropicBlock[]) => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === "user") push("user", [{ type: "text", text: m.content }]);
    else if (m.role === "tool") push("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]);
    else
      push("assistant", [
        ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
        ...(m.toolCalls ?? []).map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.args })),
      ]);
  }
  return out;
}

/**
 * Marks the end of the conversation for Anthropic's prompt cache, so each
 * later model call in the same turn (after a tool runs) reads everything
 * before it from the cache instead of processing it again.
 */
export function cachedToEnd(messages: AnthropicMessage[]): AnthropicMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.content.length === 0) return messages;
  const blocks = [...last.content];
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: EPHEMERAL };
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Cached tokens count in full: budgets stay on the safe side of the cache discount. */
function anthropicInput(usage: AnthropicUsage): number {
  return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

function readAnthropicJson(json: { content?: AnthropicBlock[]; usage?: AnthropicUsage }): LlmStep {
  const usage = json.usage ?? {};
  const blocks = json.content ?? [];
  return {
    text: blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
    toolCalls: blocks.flatMap((b) => (b.type === "tool_use" ? [{ id: callId(b.id), name: b.name, args: b.input ?? {} }] : [])),
    inputTokens: anthropicInput(usage),
    outputTokens: usage.output_tokens ?? 0,
  };
}

export function anthropicClient(conn: LlmConnection, fetchImpl: typeof fetch = fetch): LlmClient {
  return async (req) => {
    const body = {
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      // Haiku 5.5 thinks by default; household asks don't need it, it's
      // most of the wait, and replayed tool calls would need its blocks.
      ...(/^claude-haiku-5/.test(req.model) ? { thinking: { type: "disabled" } } : {}),
      system: req.system,
      messages: cachedToEnd(toAnthropicMessages(req.messages)),
      ...(req.tools.length
        ? {
            tools: req.tools.map((t, i) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
              // The tool list rarely changes, so the next ask reads it from the cache.
              ...(i === req.tools.length - 1 ? { cache_control: EPHEMERAL } : {}),
            })),
          }
        : {}),
    };
    const post = async (stream: boolean) => {
      const response = await fetchImpl(`${conn.baseURL ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": conn.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(stream ? { ...body, stream: true } : body),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Anthropic request failed (${response.status}): ${text.slice(0, 300)}`);
      }
      return response;
    };
    const plain = async () => readAnthropicJson(await (await post(false)).json());
    const streamed = async (onText: (delta: string) => void, markSent: () => void): Promise<LlmStep> => {
      const response = await post(true);
      // A proxy that ignored `stream` answered with the whole message.
      if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
        const step = readAnthropicJson(await response.json());
        if (step.text) {
          markSent();
          onText(step.text);
        }
        return step;
      }
      let text = "";
      let usage: AnthropicUsage = {};
      let failure: string | null = null;
      const blocks: ({ type: "text" } | { type: "tool_use"; id: string; name: string; json: string })[] = [];
      const reader = createSseReader((data) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data) as Record<string, unknown>;
        } catch {
          return;
        }
        const index = typeof event.index === "number" ? event.index : -1;
        if (event.type === "message_start") usage = { ...((event.message as { usage?: AnthropicUsage })?.usage ?? {}) };
        else if (event.type === "content_block_start") {
          const block = event.content_block as { type?: string; id?: string; name?: string };
          if (block?.type === "tool_use") blocks[index] = { type: "tool_use", id: block.id ?? "", name: block.name ?? "", json: "" };
          else if (block?.type === "text") blocks[index] = { type: "text" };
        } else if (event.type === "content_block_delta") {
          const delta = event.delta as { type?: string; text?: string; partial_json?: string };
          const block = blocks[index];
          if (delta?.type === "text_delta" && delta.text) {
            text += delta.text;
            markSent();
            onText(delta.text);
          } else if (delta?.type === "input_json_delta" && block?.type === "tool_use") block.json += delta.partial_json ?? "";
        } else if (event.type === "message_delta") {
          const more = (event.usage ?? {}) as AnthropicUsage;
          usage = { ...usage, ...Object.fromEntries(Object.entries(more).filter(([, v]) => typeof v === "number")) };
        } else if (event.type === "error") {
          const error = event.error as { type?: string; message?: string };
          failure = `${error?.type ?? "error"}: ${error?.message ?? "the stream failed"}`;
        }
      });
      const decoder = new TextDecoder();
      const body = response.body.getReader();
      for (;;) {
        const { done, value } = await body.read();
        if (done) break;
        reader.push(decoder.decode(value, { stream: true }));
      }
      reader.push(decoder.decode());
      reader.end();
      if (failure) throw new Error(`Anthropic stream failed: ${failure}`);
      const toolCalls: ToolCall[] = [];
      for (const b of blocks) {
        if (b?.type !== "tool_use") continue;
        let args: Record<string, unknown> = {};
        if (b.json.trim()) {
          try {
            JSON.parse(b.json);
            args = parseArgs(b.json);
          } catch {
            if (!text) throw new NotStreamed(`The streamed call to ${b.name} came in garbled.`);
          }
        }
        toolCalls.push({ id: callId(b.id), name: b.name, args });
      }
      return { text, toolCalls, inputTokens: anthropicInput(usage), outputTokens: usage.output_tokens ?? 0 };
    };
    return withStreamFallback(conn, req, streamed, plain);
  };
}

export function llmClient(conn: LlmConnection): LlmClient {
  return conn.wire === "anthropic" ? anthropicClient(conn) : openAIClient(conn);
}

/** The provider is busy or briefly down (overloaded, rate limited, a 5xx), as opposed to a bad key, model or request. */
export function isProviderBusy(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  const message = err instanceof Error ? err.message : String(err);
  return /\((429|5\d\d)\b|\b(429|5\d\d) status code|overloaded|unavailable/i.test(message);
}

export interface FallbackTarget {
  llm: LlmClient;
  model: string;
}

/**
 * When the model is busy (its SDK has already retried), the turn moves to
 * a fallback and stays there for the rest of the turn: the household's other
 * model on the same client (a string), or whatever `fallback` finds, such as
 * another provider the server has a key for (looked up only when needed).
 * `model()` says which one last answered, for the usage record.
 */
export function withFallbackModel(
  llm: LlmClient,
  fallback: string | (() => Promise<FallbackTarget | null>) | null | undefined
): LlmClient & { model: () => string | null } {
  let backup: FallbackTarget | null = null;
  let last: string | null = null;
  const client = (async (req) => {
    if (backup) {
      const step = await backup.llm({ ...req, model: backup.model });
      last = backup.model;
      return step;
    }
    // Once part of the answer is on screen, another model can't start over.
    let sent = false;
    const onText = req.onText;
    const watched = onText ? { ...req, onText: (d: string) => ((sent = true), onText(d)) } : req;
    try {
      const step = await llm(watched);
      last = req.model;
      return step;
    } catch (err) {
      if (!fallback || sent || !isProviderBusy(err)) throw err;
      const target = typeof fallback === "string" ? { llm, model: fallback } : await fallback().catch(() => null);
      if (!target || (target.llm === llm && target.model === req.model)) throw err;
      console.warn(`[assistant] ${req.model} is busy, trying ${target.model}`);
      backup = target;
      const step = await target.llm({ ...req, model: target.model });
      last = target.model;
      return step;
    }
  }) as LlmClient & { model: () => string | null };
  client.model = () => last;
  return client;
}
