import { z } from "zod";
import { isDeleteTool, toolGate, trustFor, type AssistantScope, type AssistantSettings, type ToolGate } from "@homeup/core";
import { MCP_TOOL_BY_NAME } from "@/lib/mcp-tools";
import { householdTools, type HouseholdToolContext, type ToolResult } from "@/lib/mcp/household-tools";
import type { ToolSpec } from "./llm";

// HOUP-442: the assistant's tools are the household MCP tools, each gated by
// the household's switched-on modules and the trust level for its module.
// Hidden tools are never offered to the model; proposed tools are offered,
// but the engine holds the call for the person's OK instead of running it.

export interface AssistantTool extends ToolSpec {
  module: AssistantScope;
  gate: Exclude<ToolGate, "hidden">;
  /** Only looks things up, so it may run alongside other lookups in the same step. */
  lookup?: boolean;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface AssistantToolOptions {
  settings: AssistantSettings;
  /** The person is limited to lookups (assistant_member_limits.read_only). */
  readOnly?: boolean;
}

/** Tools never offered in the household's shared chat. */
const SHARED_CHAT_HIDDEN = new Set(["add_gift_ideas"]);

function jsonSchema(shape: z.ZodRawShape | undefined): Record<string, unknown> {
  if (!shape) return { type: "object", properties: {} };
  const schema = z.toJSONSchema(z.object(shape)) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export function assistantTools(ctx: HouseholdToolContext, { settings, readOnly = false }: AssistantToolOptions): AssistantTool[] {
  return householdTools(ctx).flatMap((t) => {
    const meta = MCP_TOOL_BY_NAME[t.name];
    if (!meta || !ctx.enabled.has(meta.module)) return [];
    // Gift ideas are kept from the person they are for, who reads the shared chat too.
    if (ctx.shared && SHARED_CHAT_HIDDEN.has(t.name)) return [];
    const gate = toolGate(meta.kind, readOnly ? "read" : trustFor(settings.trust, meta.module), isDeleteTool(t.name));
    if (gate === "hidden") return [];
    const schema = t.inputSchema ? z.object(t.inputSchema) : null;
    return [
      {
        name: t.name,
        description: t.description,
        parameters: jsonSchema(t.inputSchema),
        module: meta.module,
        gate,
        lookup: meta.kind === "read",
        // Model-written arguments are validated before they reach a handler.
        run: async (args) => {
          const parsed = schema ? schema.safeParse(args) : { success: true as const, data: {} };
          if (!parsed.success) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `Invalid arguments: ${parsed.error.message}` }) }], isError: true };
          }
          return t.handler(parsed.data);
        },
      },
    ];
  });
}
