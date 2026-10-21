import OpenAI from "openai";
import { resolveReadsModel, resolveServerKey, type ParsingProvider } from "@/lib/admin-config";

// HOUP-43: a single adapter interface over the four selectable parsing
// providers. Each parse function in `parser.ts` builds a canonical JSON
// Schema once and calls `runStructuredParse` — this module owns translating
// that schema into each provider's native structured-output mechanism and
// normalizing the four wire formats back into a plain object.

export type { ParsingProvider };

export interface StructuredParseRequest {
  systemPrompt: string;
  userText: string;
  /** Data URLs (e.g. "data:image/jpeg;base64,...") */
  images?: string[];
  /** Canonical JSON Schema (OpenAI dialect) describing the desired output. */
  schema: Record<string, unknown>;
  schemaName: string;
}

const PROVIDER_KEY_NAMES: Record<ParsingProvider, string> = {
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

// Matches the placeholder values in .env.example — an untouched copy of the
// file should behave the same as an unset key.
const PROVIDER_KEY_PLACEHOLDERS: Record<ParsingProvider, string> = {
  openai: "your-openai-key",
  openrouter: "your-openrouter-key",
  gemini: "your-gemini-key",
  anthropic: "your-anthropic-key",
};

// Each provider's model for reads comes from core's AI_CATALOG (defaults.reads)
// or the operator's pick (resolveReadsModel). Gemini's is pinned (not a
// floating `-latest` alias): Google hot-swaps aliases on every release, and
// one such swap caused schema-constrained decoding to degenerate (a
// repetition loop inside a string field).

/** OpenAI's reasoning models (GPT-5 on, o-series) take max_completion_tokens and no temperature. */
export function isOpenAIReasoningModel(model: string): boolean {
  return /^(gpt-[5-9]|o[1-9])/.test(model.replace(/^openai\//, ""));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[providers] Attempt ${i + 1} failed:`, { status, msg });
      const isRateLimit = status === 429 || msg.includes("429") || msg.includes("Rate limit");
      if (!isRateLimit || i === retries) throw e;
      console.error(`[providers] Retrying in ${2000 * (i + 1)}ms...`);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error("Unreachable");
}

export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Invalid image data URL");
  }
  return { mimeType: match[1], data: match[2] };
}

// ── Gemini schema translation ─────────────────────────────────────────────
// Gemini's `responseSchema` dialect: uppercase type names, a `nullable` flag
// instead of `["x", "null"]` unions, no `additionalProperties`/`strict`, and
// (for objects) an explicit `propertyOrdering` alongside `required` — the
// recipe schema depends on this ordering for decoding stability (see the
// comment on `RECIPE_RESPONSE_SCHEMA` in parser.ts).
function toGeminiType(type: unknown): { type: string; nullable?: boolean } {
  if (Array.isArray(type)) {
    const nonNull = type.filter((t) => t !== "null");
    const nullable = nonNull.length !== type.length;
    const base = nonNull[0];
    return { type: String(base).toUpperCase(), ...(nullable ? { nullable: true } : {}) };
  }
  return { type: String(type).toUpperCase() };
}

export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { type, nullable } = toGeminiType(schema.type);
  const result: Record<string, unknown> = { type };
  if (nullable) result.nullable = true;
  if (typeof schema.description === "string") result.description = schema.description;

  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter((v) => v !== null);
    result.enum = values;
    if (values.length !== schema.enum.length) result.nullable = true;
  }

  if (type === "OBJECT" && schema.properties && typeof schema.properties === "object") {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const keys = Object.keys(properties);
    result.properties = Object.fromEntries(keys.map((k) => [k, toGeminiSchema(properties[k])]));
    result.propertyOrdering = keys;
    if (Array.isArray(schema.required)) result.required = schema.required;
  }

  if (type === "ARRAY" && schema.items && typeof schema.items === "object") {
    result.items = toGeminiSchema(schema.items as Record<string, unknown>);
  }

  return result;
}

// OpenAI's `strict: true` structured outputs require every object (at every
// nesting level) to list ALL of its properties in `required` — optional-ness
// is expressed via a `["type", "null"]` union instead. The listing/receipt
// schemas already satisfy this; the recipe schema deliberately doesn't (its
// partial `required` is a Gemini decoding-stability guard — see parser.ts),
// so send it non-strict rather than 400ing on every OpenAI/OpenRouter call.
function isFullyRequiredSchema(schema: Record<string, unknown>): boolean {
  if (schema.type === "object" && schema.properties && typeof schema.properties === "object") {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const keys = Object.keys(properties);
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (required.length !== keys.length || !keys.every((k) => required.includes(k))) return false;
    return keys.every((k) => isFullyRequiredSchema(properties[k]));
  }
  if (schema.type === "array" && schema.items && typeof schema.items === "object") {
    return isFullyRequiredSchema(schema.items as Record<string, unknown>);
  }
  return true;
}

// ── Adapters ───────────────────────────────────────────────────────────────

async function callOpenAICompatible(
  apiKey: string,
  baseURL: string | undefined,
  model: string,
  req: StructuredParseRequest
): Promise<Record<string, unknown>> {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: req.userText },
    ...(req.images ?? []).map((dataUrl) => ({
      type: "image_url" as const,
      image_url: { url: dataUrl, detail: "high" as const },
    })),
  ];

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: req.systemPrompt },
      { role: "user", content: req.images?.length ? userContent : req.userText },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: req.schemaName, strict: isFullyRequiredSchema(req.schema), schema: req.schema },
    },
    ...(isOpenAIReasoningModel(model) ? {} : { temperature: 0 }),
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI");
  return JSON.parse(content) as Record<string, unknown>;
}

async function callGemini(apiKey: string, model: string, req: StructuredParseRequest): Promise<Record<string, unknown>> {
  const imageParts = (req.images ?? []).map((dataUrl) => {
    const { mimeType, data } = parseDataUrl(dataUrl);
    return { inline_data: { mime_type: mimeType, data } };
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "X-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ parts: [{ text: req.userText }, ...imageParts] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: toGeminiSchema(req.schema),
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const json = await response.json();
  const blockReason = json?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Parse was blocked: ${blockReason}`);
  }

  // Join ALL text parts (skipping thought summaries): thinking-capable models
  // can split the answer across parts, and parts[0] alone may be a fragment.
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .filter((p: { text?: string; thought?: boolean }) => p?.text && !p.thought)
        .map((p: { text?: string }) => p.text)
        .join("")
    : undefined;
  if (!text) throw new Error("No response from Gemini");

  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error("Could not parse structured data from Gemini response");
  }
}

async function callAnthropic(apiKey: string, model: string, req: StructuredParseRequest): Promise<Record<string, unknown>> {
  const imageBlocks = (req.images ?? []).map((dataUrl) => {
    const { mimeType, data } = parseDataUrl(dataUrl);
    return {
      type: "image" as const,
      source: { type: "base64" as const, media_type: mimeType, data },
    };
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: req.systemPrompt,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: req.userText }, ...imageBlocks],
        },
      ],
      tools: [{ name: req.schemaName, description: "Return the extracted data.", input_schema: req.schema }],
      tool_choice: { type: "tool", name: req.schemaName },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const json = await response.json();
  const toolUse = Array.isArray(json?.content)
    ? json.content.find((b: { type?: string }) => b?.type === "tool_use")
    : undefined;
  if (!toolUse) throw new Error("No structured response from Anthropic");
  return toolUse.input as Record<string, unknown>;
}

// ── Entry point ──────────────────────────────────────────────────────────

/** A resolved key for one AI read (lib/ai/access.ts): the household's own, or the server's. */
export interface AiCallKey {
  provider: ParsingProvider;
  apiKey: string;
  /** The model to read with; unset uses resolveReadsModel. */
  model?: string;
}

/** The server's key for a provider, or undefined when unset or still the .env.example placeholder. */
export async function serverProviderKey(provider: ParsingProvider): Promise<string | undefined> {
  const apiKey = (await resolveServerKey(PROVIDER_KEY_NAMES[provider]))?.trim();
  return apiKey && apiKey !== PROVIDER_KEY_PLACEHOLDERS[provider] ? apiKey : undefined;
}

export async function runStructuredParse(
  provider: ParsingProvider,
  req: StructuredParseRequest,
  key?: string,
  model?: string
): Promise<Record<string, unknown>> {
  const apiKey = key ?? (await serverProviderKey(provider));
  if (!apiKey) {
    throw new Error(`${PROVIDER_KEY_NAMES[provider]} is not configured`);
  }
  const use = model ?? (await resolveReadsModel(provider));

  return withRetry(() => {
    switch (provider) {
      case "openai":
        return callOpenAICompatible(apiKey, undefined, use, req);
      case "openrouter":
        return callOpenAICompatible(apiKey, "https://openrouter.ai/api/v1", use, req);
      case "gemini":
        return callGemini(apiKey, use, req);
      case "anthropic":
        return callAnthropic(apiKey, use, req);
    }
  });
}
