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
              })),
            }
          : {}),
      });
  }
  return out;
}

export function openAIClient(conn: LlmConnection): LlmClient {
  const client = new OpenAI({ apiKey: conn.apiKey || "not-needed", ...(conn.baseURL ? { baseURL: conn.baseURL } : {}) });
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
      max_tokens: req.maxTokens ?? 1024,
    });
    const message = response.choices[0]?.message;
    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).flatMap((c) =>
      c.type === "function" ? [{ id: callId(c.id), name: c.function.name, args: parseArgs(c.function.arguments) }] : []
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

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

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

export function anthropicClient(conn: LlmConnection, fetchImpl: typeof fetch = fetch): LlmClient {
  return async (req) => {
    const response = await fetchImpl(`${conn.baseURL ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": conn.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        system: req.system,
        messages: toAnthropicMessages(req.messages),
        ...(req.tools.length
          ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
          : {}),
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic request failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const json = (await response.json()) as {
      content?: AnthropicBlock[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const blocks = json.content ?? [];
    return {
      text: blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
      toolCalls: blocks.flatMap((b) => (b.type === "tool_use" ? [{ id: callId(b.id), name: b.name, args: b.input ?? {} }] : [])),
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
    };
  };
}

export function llmClient(conn: LlmConnection): LlmClient {
  return conn.wire === "anthropic" ? anthropicClient(conn) : openAIClient(conn);
}
