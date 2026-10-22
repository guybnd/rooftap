import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseScoutBrief,
  scoutLatestRun,
  todayISO,
  SCOUT_WHERE_LABELS,
  type Group,
  type ScoutBrief,
  type ScoutMessage,
  type ScoutThread,
  type ShopperPick,
  type ShopperSearch,
} from "@homeup/core";
import type { AssistantBrain } from "@/lib/assistant/provider";
import type { ChatMessage, LlmClient, ToolSpec } from "@/lib/assistant/llm";
import { sourceContext } from "./lookup";
import { SCOUT_TOOLS, money, type FoundOffer } from "./scout";

// Scout threads: a follow-up on a Scout run. The model sees the brief, every
// run's picks and the conversation so far, and either answers in words
// (checking a price or two with search_prices if it needs to) or calls
// search_again with the changed brief, which the route turns into a new run
// in the same thread. It never makes up a price: prices come from the picks
// or from a search in this turn.

/** Model turns per follow-up, searches included. */
const MAX_STEPS = 4;
/** Price checks per follow-up. A real hunt is a refined run instead. */
const MAX_SEARCHES = 2;
/** Offers shown to the model per price check. */
const OFFERS_PER_SEARCH = 8;
/** Earlier messages sent along with a follow-up. */
const HISTORY = 12;
/** Longest answer kept. */
const ANSWER_MAX = 1200;

/** A thread, from any of its runs' ids: the first run, every refined run, all picks and messages. */
export async function readThread(admin: SupabaseClient, id: string): Promise<ScoutThread | null> {
  const { data: asked } = await admin.from("shopper_searches").select("*").eq("id", id).eq("deleted", false).maybeSingle();
  if (!asked) return null;
  const rootId = (asked as ShopperSearch).thread_id ?? (asked as ShopperSearch).id;
  const [{ data: runs }, { data: messages }] = await Promise.all([
    admin.from("shopper_searches").select("*").or(`id.eq.${rootId},thread_id.eq.${rootId}`).eq("deleted", false).order("created_at", { ascending: true }),
    admin.from("shopper_scout_messages").select("*").eq("thread_id", rootId).eq("deleted", false).order("created_at", { ascending: true }),
  ]);
  const list = (runs ?? []) as ShopperSearch[];
  if (!list.length) return null;
  const { data: picks } = await admin
    .from("shopper_picks")
    .select("*")
    .in("search_id", list.map((r) => r.id))
    .eq("deleted", false)
    .order("rank", { ascending: true });
  return { runs: list, picks: (picks ?? []) as ShopperPick[], messages: (messages ?? []) as ScoutMessage[] };
}

/** The first run of a thread. */
export function threadRoot(thread: ScoutThread): ShopperSearch {
  return thread.runs.find((r) => !r.thread_id) ?? thread.runs[0];
}

function briefLine(brief: ScoutBrief, currency: string): string {
  const budget =
    brief.budget_min_cents != null && brief.budget_max_cents != null
      ? `${money(brief.budget_min_cents, currency)} to ${money(brief.budget_max_cents, currency)}`
      : brief.budget_max_cents != null
        ? `up to ${money(brief.budget_max_cents, currency)}`
        : brief.budget_min_cents != null
          ? `from ${money(brief.budget_min_cents, currency)}`
          : "not set";
  return `"${brief.text}" | budget ${budget} | need by ${brief.need_by ?? "no rush"} | ${brief.where.map((w) => SCOUT_WHERE_LABELS[w]).join(", ")}`;
}

function pickLine(p: ShopperPick): string {
  const stock = p.in_stock === true ? "in stock" : p.in_stock === false ? "out of stock" : "stock unknown";
  return `  ${p.rank}. ${p.title} | ${p.store} | ${money(p.price_cents, p.currency)} | ${stock}${p.stretch ? " | over budget" : ""}${p.label ? ` | ${p.label}` : ""}${p.why ? `\n     why: ${p.why}` : ""}`;
}

export function followUpSystemPrompt(thread: ScoutThread, group: Pick<Group, "region" | "currency">, currency: string, focus: ShopperPick | null, today = todayISO()): string {
  const latest = scoutLatestRun(thread);
  const runs = [...thread.runs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const runBlocks = runs.map((run) => {
    const picks = thread.picks.filter((p) => p.search_id === run.id).sort((a, b) => a.rank - b.rank);
    const head = run.id === latest?.id ? "Latest search (the picks the person sees on top)" : "Earlier search";
    const body = picks.length ? picks.map(pickLine).join("\n") : run.status === "running" ? "  still searching" : "  no picks";
    return `${head}: ${briefLine(run.brief, currency)}\n${body}`;
  });
  return [
    "You are Scout, a shopping researcher for one household. You already searched for them, and now they are asking a follow-up about your picks or want to change the search.",
    `Today is ${today}. The household is in ${(group.region || "AU").toUpperCase()} and pays in ${currency}.`,
    "",
    runBlocks.join("\n\n"),
    "",
    "How to answer:",
    "- A question (compare picks, is it worth it, will it fit, what does it lack): answer in two to four plain sentences. Refer to picks by number from the latest search, like \"pick 2\". Use what you know about the products, and say when you are not sure.",
    `- To check a price you don't have, call search_prices with a short product search (up to ${MAX_SEARCHES} times). Only quote prices from the picks or from those results.`,
    "- A change to what they want (budget, size, brand, features, where to buy, a different kind of thing, or asking you to find more options): call search_again with the whole new brief, not only the change. Keep everything they didn't change. Don't answer in words as well.",
    "- If it's unclear whether they want a new search, answer the question and offer to search again.",
    "Write for the household: plain words, no em-dashes, no emoji, no headings.",
    focus ? `\nThey are asking about pick ${focus.rank} from ${focus.search_id === latest?.id ? "the latest search" : "an earlier search"}: ${focus.title} at ${focus.store}.` : "",
  ]
    .join("\n")
    .trim();
}

export const SEARCH_AGAIN_TOOL: ToolSpec = {
  name: "search_again",
  description: "Start a new search with a changed brief. Its picks appear below in the same thread.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The whole brief in the household's words, with the change worked in." },
      budget_min: { type: "number", description: "Lowest price in whole currency units, or 0 for none." },
      budget_max: { type: "number", description: "Highest price in whole currency units, or 0 for none." },
      need_by: { type: "string", description: "YYYY-MM-DD, or empty for no rush." },
      where: { type: "array", items: { type: "string", enum: ["nearby", "online", "secondhand"] } },
      summary: { type: "string", description: "What changed, in a few words for the household, like \"with a grill\"." },
    },
    required: ["text", "summary"],
  },
};

const FOLLOW_UP_TOOLS: ToolSpec[] = [SCOUT_TOOLS.find((t) => t.name === "search_prices")!, SEARCH_AGAIN_TOOL];

export type FollowUpOutcome =
  | { kind: "answer"; text: string }
  | { kind: "refine"; brief: ScoutBrief; summary: string }
  | { kind: "error"; text: string };

/** The model's search_again call as a clean brief, keeping what it didn't change. */
export function refinedBrief(args: Record<string, unknown>, current: ScoutBrief): ScoutBrief | null {
  // Whole units from the model, absent to keep, zero to clear.
  const cents = (v: unknown, keep: number | null) => (typeof v === "number" && Number.isFinite(v) ? (v > 0 ? Math.round(v * 100) : null) : keep);
  const parsed = parseScoutBrief({
    text: typeof args.text === "string" && args.text.trim() ? args.text : current.text,
    budget_min_cents: cents(args.budget_min, current.budget_min_cents),
    budget_max_cents: cents(args.budget_max, current.budget_max_cents),
    need_by: typeof args.need_by === "string" ? args.need_by : current.need_by,
    where: Array.isArray(args.where) && args.where.length ? args.where : current.where,
  });
  return "brief" in parsed ? parsed.brief : null;
}

function clean(text: string, max: number): string {
  return text.replace(/\s*[—–]\s*/g, ", ").trim().slice(0, max);
}

/** One follow-up: an answer in words, or a changed brief for a new run. Pure apart from its deps. */
export async function runFollowUp(
  thread: ScoutThread,
  ask: { text: string; pick: ShopperPick | null },
  group: Group,
  deps: { brain: AssistantBrain; llm: LlmClient; search: (query: string) => Promise<FoundOffer[]> },
): Promise<FollowUpOutcome> {
  const currency = sourceContext(group).currency;
  const latest = scoutLatestRun(thread) ?? threadRoot(thread);
  const system = followUpSystemPrompt(thread, group, currency, ask.pick);
  const history: ChatMessage[] = thread.messages
    .filter((m) => !m.deleted && m.text)
    .slice(-HISTORY)
    .map((m) => (m.role === "user" ? { role: "user" as const, content: m.text } : { role: "assistant" as const, content: m.text }));
  const messages: ChatMessage[] = [...history, { role: "user", content: ask.text }];
  let searches = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const last = step === MAX_STEPS - 1;
    const reply = await deps.llm({
      model: deps.brain.chatModel,
      system,
      messages,
      tools: last ? [SEARCH_AGAIN_TOOL] : FOLLOW_UP_TOOLS,
      maxTokens: 900,
    });
    const again = reply.toolCalls.find((c) => c.name === "search_again");
    if (again) {
      const brief = refinedBrief(again.args, latest.brief);
      if (brief) return { kind: "refine", brief, summary: clean(typeof again.args.summary === "string" ? again.args.summary : "", 80) };
    }
    if (!reply.toolCalls.length) {
      const text = clean(reply.text, ANSWER_MAX);
      return text ? { kind: "answer", text } : { kind: "error", text: "Scout didn't have an answer for that. Try asking another way." };
    }
    messages.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls });
    for (const call of reply.toolCalls) {
      if (call.name !== "search_prices") {
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: call.name === "search_again" ? "That brief was empty. Try again with the whole brief." : "Unknown tool." });
        continue;
      }
      const query = typeof call.args.query === "string" ? call.args.query.trim().slice(0, 120) : "";
      if (!query || searches >= MAX_SEARCHES) {
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: "No more price checks. Answer with what you have." });
        continue;
      }
      searches++;
      const offers = (await deps.search(query)).slice(0, OFFERS_PER_SEARCH);
      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: offers.length
          ? offers.map((o) => `${o.title} | ${o.store} | ${money(o.price_cents, o.currency)} | ${o.in_stock === true ? "in stock" : o.in_stock === false ? "out of stock" : "stock unknown"}`).join("\n")
          : `No offers matched "${query}".`,
      });
    }
  }
  return { kind: "error", text: "Scout couldn't finish that answer. Try asking another way." };
}
