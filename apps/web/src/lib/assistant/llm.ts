import OpenAI from "openai";

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
    const response = await client.chat.completions.create({
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
    });
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

export function anthropicClient(conn: LlmConnection, fetchImpl: typeof fetch = fetch): LlmClient {
  return async (req) => {
    const response = await fetchImpl(`${conn.baseURL ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": conn.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
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
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic request failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const json = (await response.json()) as {
      content?: AnthropicBlock[];
      usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
    };
    const usage = json.usage ?? {};
    const blocks = json.content ?? [];
    return {
      text: blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
      toolCalls: blocks.flatMap((b) => (b.type === "tool_use" ? [{ id: callId(b.id), name: b.name, args: b.input ?? {} }] : [])),
      // Cached tokens count in full: budgets stay on the safe side of the cache discount.
      inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      outputTokens: usage.output_tokens ?? 0,
    };
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
    try {
      const step = await llm(req);
      last = req.model;
      return step;
    } catch (err) {
      if (!fallback || !isProviderBusy(err)) throw err;
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
