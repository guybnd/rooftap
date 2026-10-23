import { extractMemoryMarkers, toolStatus, visibleDraftText } from "@homeup/core";
import type { ChatImage, ChatMessage, LlmClient, ToolCall } from "./llm";
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
  /** Photos sent with the message, for the model to look at. */
  userImages?: ChatImage[];
  tools: AssistantTool[];
  maxSteps?: number;
  /**
   * Wall-clock limits (epoch ms), so a turn ends inside the server's time
   * limit with an answer instead of being cut off: after `answerBy` the
   * model gets no more tools and must answer with what it has; a model
   * call still going at `giveUpAt` fails the turn with TurnTimeoutError.
   */
  deadline?: { answerBy: number; giveUpAt: number };
  /** Called as each model call and tool finishes, for the server log (a turn cut off never reaches its summary line). */
  onEvent?: (event: { kind: "llm" | "tool"; name?: string; ms: number; step: number }) => void;
  /** The turn as it happens, for a streamed reply (HOUP-509): each new model call, what the tools are doing, and the answer's text. */
  onStream?: (event: TurnStreamEvent) => void;
}

export type TurnStreamEvent = { type: "step" } | { type: "status"; text: string } | { type: "text"; text: string };

export class TurnTimeoutError extends Error {
  constructor() {
    super("The assistant took too long to answer.");
  }
}

export const OUT_OF_TIME_REPLY = "I ran out of time before I could finish that. Try asking again, or ask for less at once.";

/** Added to the system prompt once time is short. */
export const ANSWER_NOW_NOTE =
  "Time is nearly up for this message: don't call any more tools. Answer now with what you already found, and say briefly if something is left to check.";

function before<T>(work: Promise<T>, at: number | undefined): Promise<T> {
  if (at === undefined) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TurnTimeoutError()), Math.max(0, at - Date.now()));
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
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
  /** Where the time went: each model call, and each tool that ran, in milliseconds. */
  timing: { llmMs: number[]; tools: { tool: string; ms: number }[] };
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
  out: CallOut
): Promise<string> {
  const tool = byName.get(call.name);
  if (!tool) return JSON.stringify({ error: `No tool called ${call.name} is available.` });
  if (tool.gate === "propose") {
    out.proposals.push({ toolCallId: call.id, tool: tool.name, module: tool.module, args: call.args });
    return JSON.stringify({ status: "proposed", note: "Held for the person's OK. Tell them what you proposed; it has not happened yet." });
  }
  const started = Date.now();
  try {
    const result = await tool.run(call.args);
    out.ran.push({ tool: tool.name, args: call.args, ok: !result.isError });
    return capped(resultText(result));
  } catch (e) {
    out.ran.push({ tool: tool.name, args: call.args, ok: false });
    return JSON.stringify({ error: e instanceof Error ? e.message : "Tool failed" });
  } finally {
    const ms = Date.now() - started;
    out.timing.tools.push({ tool: tool.name, ms });
    out.onTool?.(tool.name, ms);
  }
}

type CallOut = Pick<TurnResult, "proposals" | "ran" | "timing"> & { onTool?: (name: string, ms: number) => void };

/**
 * Runs one step's calls. Lookups run side by side (a model often asks for
 * several at once, and each may be a round trip to Home Assistant); changes
 * run one after another, in the order asked, after the lookups.
 */
async function handleCalls(calls: ToolCall[], byName: Map<string, AssistantTool>, out: CallOut) {
  const contents = new Array<string>(calls.length);
  const lookups = calls.flatMap((c, i) => (byName.get(c.name)?.lookup && byName.get(c.name)?.gate === "run" ? [i] : []));
  await Promise.all(lookups.map(async (i) => (contents[i] = await handleCall(calls[i], byName, out))));
  for (let i = 0; i < calls.length; i++) if (contents[i] === undefined) contents[i] = await handleCall(calls[i], byName, out);
  return contents;
}

export async function runAssistantTurn(input: TurnInput): Promise<TurnResult> {
  const maxSteps = input.maxSteps ?? MAX_STEPS;
  const byName = new Map(input.tools.map((t) => [t.name, t]));
  const specs = input.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const conversation: ChatMessage[] = [
    ...input.history,
    { role: "user", content: input.userText, ...(input.userImages?.length ? { images: input.userImages } : {}) },
  ];
  const result: TurnResult = { reply: "", memories: [], messages: [], proposals: [], inputTokens: 0, outputTokens: 0, steps: 0, ran: [], timing: { llmMs: [], tools: [] } };

  const out: CallOut = {
    proposals: result.proposals,
    ran: result.ran,
    timing: result.timing,
    onTool: (name, ms) => input.onEvent?.({ kind: "tool", name, ms, step: result.steps }),
  };

  for (let step = 0; step < maxSteps; step++) {
    const asked = Date.now();
    if (step > 0) input.onStream?.({ type: "step" });
    // Memory markers are cut from the reply, so they never stream either.
    let raw = "";
    let shown = "";
    const stream = input.onStream;
    const onText = stream
      ? (delta: string) => {
          raw += delta;
          const visible = visibleDraftText(raw);
          if (visible.length > shown.length && visible.startsWith(shown)) {
            stream({ type: "text", text: visible.slice(shown.length) });
            shown = visible;
          }
        }
      : undefined;
    // Out of time for more lookups: the model answers with what it has.
    const hurry = !!input.deadline && asked >= input.deadline.answerBy;
    const res = await before(
      input.llm({
        model: input.model,
        system: hurry ? `${input.system}\n\n${ANSWER_NOW_NOTE}` : input.system,
        messages: conversation,
        // Still offered, since the history holds tool calls (some providers refuse those without tools).
        tools: specs,
        ...(onText ? { onText } : {}),
      }),
      input.deadline?.giveUpAt
    );
    result.timing.llmMs.push(Date.now() - asked);
    input.onEvent?.({ kind: "llm", ms: Date.now() - asked, step });
    result.steps++;
    result.inputTokens += res.inputTokens;
    result.outputTokens += res.outputTokens;

    // Asked to answer but reached for another tool anyway: stop here.
    if (hurry && res.toolCalls.length > 0) res.toolCalls = [];
    if (hurry && res.toolCalls.length === 0 && !res.text.trim()) res.text = OUT_OF_TIME_REPLY;

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
    const ranBefore = result.ran.length;
    const proposedBefore = result.proposals.length;
    const status = toolStatus(
      res.toolCalls.flatMap((c) => {
        const tool = byName.get(c.name);
        return tool && tool.gate === "run" ? [{ tool: tool.name, module: tool.module, lookup: tool.lookup, args: c.args }] : [];
      })
    );
    if (status) input.onStream?.({ type: "status", text: status });
    const contents = await handleCalls(res.toolCalls, byName, out);
    res.toolCalls.forEach((call, i) => {
      const toolMessage: ChatMessage = { role: "tool", toolCallId: call.id, name: call.name, content: contents[i] };
      conversation.push(toolMessage);
      result.messages.push(toolMessage);
    });

    // A step that only made changes, all of which went through, and already
    // said so: that line is the answer, without another model call to
    // write it (about a second and a half). Anything else goes back to the model.
    const ran = result.ran.slice(ranBefore);
    const confirmation = extractMemoryMarkers(res.text);
    if (
      confirmation.cleanedText &&
      result.proposals.length === proposedBefore &&
      ran.length === res.toolCalls.length &&
      ran.every((r) => r.ok) &&
      res.toolCalls.every((c) => !byName.get(c.name)?.lookup)
    ) {
      // The line moves to the end, so the stored turn reads change, result, reply.
      assistant.content = "";
      result.reply = confirmation.cleanedText;
      result.memories = confirmation.memories;
      result.messages.push({ role: "assistant", content: confirmation.cleanedText });
      return result;
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
/**
 * Why a change failed, in a few words a person can read: the error a tool
 * returned (often JSON like {"error": "..."}), squeezed onto one short line.
 */
export function failureReason(text: string): string {
  let reason = text;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      const picked = [o.error, o.message, o.detail].find((v) => typeof v === "string" && v.trim());
      if (typeof picked === "string") reason = picked;
    }
  } catch {
    // Plain text is the reason as it is.
  }
  reason = reason.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  return reason.length > 160 ? `${reason.slice(0, 157)}...` : reason;
}

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
