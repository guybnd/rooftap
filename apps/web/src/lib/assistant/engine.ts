import { extractMemoryMarkers } from "@homeup/core";
import type { ChatMessage, LlmClient, ToolCall } from "./llm";
import type { AssistantTool } from "./tools";

// HOUP-442: one assistant turn. Sends the conversation to the model, runs
// the tools it asks for (or holds them as proposals under trust "ask"), and
// loops until the model answers or the step cap is reached. Pure apart from
// the injected model client and tool handlers, so routes, Telegram and
// routines all share it and tests can drive it with a scripted model.

export const MAX_STEPS = 8;

/** Tool output sent back to the model is capped to keep turns cheap. */
export const MAX_TOOL_RESULT_CHARS = 12_000;

export interface Proposal {
  toolCallId: string;
  tool: string;
  module: string;
  args: Record<string, unknown>;
}

export interface TurnInput {
  llm: LlmClient;
  model: string;
  system: string;
  /** Earlier messages in the context window, oldest first. */
  history: ChatMessage[];
  userText: string;
  tools: AssistantTool[];
  maxSteps?: number;
}

export interface TurnResult {
  /** What the person sees, with memory markers removed. */
  reply: string;
  /** Facts the model asked to remember. */
  memories: string[];
  /** Assistant and tool messages produced this turn, in order (the user message not included). */
  messages: ChatMessage[];
  proposals: Proposal[];
  inputTokens: number;
  outputTokens: number;
  steps: number;
  /** Tools that ran (not proposals), for the activity line and Undo. */
  ran: { tool: string; args: Record<string, unknown>; ok: boolean }[];
}

export const STEP_LIMIT_REPLY = "That took more steps than I can do in one go. Could you break it into smaller asks?";

function capped(text: string): string {
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… (truncated)` : text;
}

function resultText(result: { content: { text: string }[] }): string {
  return result.content.map((c) => c.text).join("\n");
}

async function handleCall(
  call: ToolCall,
  byName: Map<string, AssistantTool>,
  out: Pick<TurnResult, "proposals" | "ran">
): Promise<string> {
  const tool = byName.get(call.name);
  if (!tool) return JSON.stringify({ error: `No tool called ${call.name} is available.` });
  if (tool.gate === "propose") {
    out.proposals.push({ toolCallId: call.id, tool: tool.name, module: tool.module, args: call.args });
    return JSON.stringify({ status: "proposed", note: "Held for the person's OK. Tell them what you proposed; it has not happened yet." });
  }
  try {
    const result = await tool.run(call.args);
    out.ran.push({ tool: tool.name, args: call.args, ok: !result.isError });
    return capped(resultText(result));
  } catch (e) {
    out.ran.push({ tool: tool.name, args: call.args, ok: false });
    return JSON.stringify({ error: e instanceof Error ? e.message : "Tool failed" });
  }
}

export async function runAssistantTurn(input: TurnInput): Promise<TurnResult> {
  const maxSteps = input.maxSteps ?? MAX_STEPS;
  const byName = new Map(input.tools.map((t) => [t.name, t]));
  const specs = input.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const conversation: ChatMessage[] = [...input.history, { role: "user", content: input.userText }];
  const result: TurnResult = { reply: "", memories: [], messages: [], proposals: [], inputTokens: 0, outputTokens: 0, steps: 0, ran: [] };

  for (let step = 0; step < maxSteps; step++) {
    const res = await input.llm({ model: input.model, system: input.system, messages: conversation, tools: specs });
    result.steps++;
    result.inputTokens += res.inputTokens;
    result.outputTokens += res.outputTokens;

    if (res.toolCalls.length === 0) {
      const { cleanedText, memories } = extractMemoryMarkers(res.text);
      result.reply = cleanedText;
      result.memories = memories;
      const final: ChatMessage = { role: "assistant", content: cleanedText };
      result.messages.push(final);
      return result;
    }

    const assistant: ChatMessage = { role: "assistant", content: res.text, toolCalls: res.toolCalls };
    conversation.push(assistant);
    result.messages.push(assistant);
    for (const call of res.toolCalls) {
      const content = await handleCall(call, byName, result);
      const toolMessage: ChatMessage = { role: "tool", toolCallId: call.id, name: call.name, content };
      conversation.push(toolMessage);
      result.messages.push(toolMessage);
    }
  }

  result.reply = STEP_LIMIT_REPLY;
  result.messages.push({ role: "assistant", content: STEP_LIMIT_REPLY });
  return result;
}

/**
 * Runs held proposals once the person confirms, through the same tools
 * (ignoring the gate: the tap is the OK). Each tool must still be offered,
 * so a module switched off or a trust level lowered since then wins.
 */
export async function executeProposals(proposals: Proposal[], tools: AssistantTool[]) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const outcomes: { tool: string; ok: boolean; text: string }[] = [];
  for (const p of proposals) {
    const tool = byName.get(p.tool);
    if (!tool) {
      outcomes.push({ tool: p.tool, ok: false, text: "That change is no longer allowed." });
      continue;
    }
    try {
      const res = await tool.run(p.args);
      outcomes.push({ tool: p.tool, ok: !res.isError, text: resultText(res) });
    } catch (e) {
      outcomes.push({ tool: p.tool, ok: false, text: e instanceof Error ? e.message : "Tool failed" });
    }
  }
  return outcomes;
}
