import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aiAccess,
  checkSourceOffers,
  cleanOfferUrl,
  mergeSourceOffers,
  relevantOffers,
  PLUS_SCOUT_RUNS_PER_MONTH,
  SCOUT_MAX_PICKS,
  SCOUT_WHERE_LABELS,
  sortOffers,
  todayISO,
  type AiErrorCode,
  type Group,
  type ScoutBrief,
  type ScoutSource,
  type ShopperPick,
  type ShopperSearch,
  type ShopperWant,
  type SourceOffer,
} from "@homeup/core";
import { billingMode, householdTier } from "@/lib/billing";
import { householdKeys } from "@/lib/ai/household-keys";
import { resolveHouseholdBrain, resolveServerBrain, type AssistantBrain } from "@/lib/assistant/provider";
import { llmClient, type ChatMessage, type LlmClient, type ToolSpec } from "@/lib/assistant/llm";
import { applicableSources, householdDisabledSources, sourceContext } from "./lookup";

// HOUP-435: Scout's agent. A household's brief goes to a model with two
// tools: search_prices, which runs a query through every Shopper source that
// applies to the household (the same registry and relevance filter as the
// Watchlist), and submit_picks, which ends the run. Picks can only point at
// offers a search returned in this run, so every price, store, link and stock
// claim comes from a source, never from the model.

/** Model turns per run, searches included. */
const MAX_STEPS = 10;
/** Searches per run, so one brief can't burn a source's rate limit. */
const MAX_SEARCHES = 6;
/** Offers shown to the model per search, cheapest first. */
const OFFERS_PER_SEARCH = 12;
/** Stop asking the model for more once a run has gone this long. */
const RUN_DEADLINE_MS = 50_000;

export type FoundOffer = SourceOffer & { source_id: string; distance_m: number | null };

export interface ScoutDeps {
  brain?: AssistantBrain | null;
  llm?: LlmClient;
  /** One query across the household's offer sources, filtered and merged. */
  search?: (query: string) => Promise<FoundOffer[]>;
  now?: () => number;
}

export type ScoutBrainResult = { brain: AssistantBrain } | { blocked: AiErrorCode };

/** Scout runs this household made on the server's key this month. */
export async function monthServerRuns(admin: SupabaseClient, groupId: string, now = new Date()): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count, error } = await admin
    .from("shopper_searches")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId)
    .eq("key_source", "server")
    .gte("created_at", monthStart);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Whose model a Scout run uses: the household's own key first (no cap), else
 * the server's when the plan allows it, up to PLUS_SCOUT_RUNS_PER_MONTH on
 * hosted Plus. Same order and codes as HOUP-436's single-shot reads.
 */
export async function scoutBrain(admin: SupabaseClient, groupId: string): Promise<ScoutBrainResult> {
  const own = resolveHouseholdBrain(await householdKeys(admin, groupId));
  if (own) return { brain: own };
  const access = aiAccess(await householdTier(admin, groupId), billingMode());
  if (access === "none") return { blocked: "ai_requires_plus" };
  const server = await resolveServerBrain();
  if (!server) return { blocked: "ai_not_configured" };
  if (access === "allowance" && (await monthServerRuns(admin, groupId)) >= PLUS_SCOUT_RUNS_PER_MONTH) return { blocked: "ai_allowance_used" };
  return { brain: server };
}

/** A search across the household's offer sources, keeping only the thing itself. */
export function sourceSearch(group: Group, brief: ScoutBrief): (query: string) => Promise<FoundOffer[]> {
  const ctx = sourceContext(group);
  const ready = applicableSources(ctx, "offers", householdDisabledSources(group));
  return async (query) => {
    const found: FoundOffer[] = [];
    await Promise.all(
      (await ready).map(async ({ source, ctx: callCtx }) => {
        try {
          for (const o of (await source.searchOffers?.(query, callCtx)) ?? []) {
            const offer = { ...o, url: cleanOfferUrl(o.url) };
            if (checkSourceOffers([offer], ctx).length) continue;
            found.push({ ...offer, source_id: source.manifest.id, distance_m: null });
          }
        } catch (err) {
          console.warn(`scout source ${source.manifest.id} failed:`, err instanceof Error ? err.message : err);
        }
      }),
    );
    return sortOffers(mergeSourceOffers(relevantOffers(query, found, { referenceCents: brief.budget_min_cents })));
  };
}

/** Whether any offer source applies to this household, so a run can't start with nothing to search. */
export async function hasOfferSources(group: Group): Promise<boolean> {
  return (await applicableSources(sourceContext(group), "offers", householdDisabledSources(group))).length > 0;
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

export function scoutSystemPrompt(brief: ScoutBrief, group: Pick<Group, "region" | "currency">, currency: string, today = todayISO()): string {
  const budget =
    brief.budget_min_cents != null && brief.budget_max_cents != null
      ? `${money(brief.budget_min_cents, currency)} to ${money(brief.budget_max_cents, currency)}`
      : brief.budget_max_cents != null
        ? `up to ${money(brief.budget_max_cents, currency)}`
        : brief.budget_min_cents != null
          ? `from ${money(brief.budget_min_cents, currency)}`
          : "not set";
  return [
    "You are Scout, a shopping researcher for one household. Find the best few products for their brief.",
    `Today is ${today}. The household is in ${(group.region || "AU").toUpperCase()} and pays in ${currency}.`,
    `Budget: ${budget}. Need by: ${brief.need_by ?? "no rush"}. Where they'll buy: ${brief.where.map((w) => SCOUT_WHERE_LABELS[w]).join(", ")}.`,
    "",
    "How to work:",
    "1. Decide which specific products fit the brief from what you know, then call search_prices with short product searches (brand and model, like \"LG C4 65\"), not the whole brief. A couple of broader searches (\"65 inch OLED TV\") are fine too.",
    `2. You can search up to ${MAX_SEARCHES} times. Each offer comes back with a ref like o3.`,
    `3. Call submit_picks with 1 to ${SCOUT_MAX_PICKS} picks, best first. Each pick must use an offer_ref from a search; never invent a price, store or link.`,
    "4. The budget and need-by date are hard limits. A pick over budget is allowed only with stretch: true and a reason in why.",
    "5. Prefer offers marked in stock. Give each pick a short label (\"best value\", \"best picture\", \"stretch\") and a why of one or two plain sentences on how it fits this brief.",
    "Write for the household: plain words, no em-dashes, no emoji.",
    "",
    `Brief: ${brief.text}`,
  ].join("\n");
}

export const SCOUT_TOOLS: ToolSpec[] = [
  {
    name: "search_prices",
    description: "Search the household's price sources for a product. Returns today's offers that match, cheapest first, each with a ref.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "A short product search, like a brand and model." } },
      required: ["query"],
    },
  },
  {
    name: "submit_picks",
    description: "Finish the research with your picks, best first.",
    parameters: {
      type: "object",
      properties: {
        picks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              offer_ref: { type: "string", description: "The ref of the offer this pick is, from search_prices." },
              label: { type: "string", description: "Short role in the list, like best value." },
              why: { type: "string", description: "One or two sentences on why it fits the brief." },
              stretch: { type: "boolean", description: "True only for a pick over budget." },
              also_refs: { type: "array", items: { type: "string" }, description: "Refs of the same product at other stores, as extra sources." },
            },
            required: ["offer_ref", "label", "why"],
          },
        },
      },
      required: ["picks"],
    },
  },
];

export interface ScoutPickDraft {
  rank: number;
  label: string;
  title: string;
  why: string;
  price_cents: number;
  currency: string;
  store: string;
  url: string | null;
  in_stock: boolean | null;
  stretch: boolean;
  sources: ScoutSource[];
}

/** The model's submit_picks call, checked against the offers this run saw. */
export function draftPicks(raw: unknown, seen: ReadonlyMap<string, FoundOffer>, brief: ScoutBrief): ScoutPickDraft[] {
  const list = Array.isArray((raw as { picks?: unknown })?.picks) ? ((raw as { picks: unknown[] }).picks) : [];
  const out: ScoutPickDraft[] = [];
  const used = new Set<string>();
  for (const item of list) {
    if (out.length >= SCOUT_MAX_PICKS) break;
    const p = (item ?? {}) as Record<string, unknown>;
    const ref = typeof p.offer_ref === "string" ? p.offer_ref.trim() : "";
    const offer = seen.get(ref);
    if (!offer || used.has(ref)) continue;
    const over = brief.budget_max_cents != null && offer.price_cents > brief.budget_max_cents;
    // Over budget only as a labelled stretch.
    if (over && p.stretch !== true) continue;
    used.add(ref);
    const sources: ScoutSource[] = [];
    const addSource = (o: FoundOffer) => {
      if (o.url && !sources.some((s) => s.url === o.url)) sources.push({ title: o.store, url: o.url });
    };
    addSource(offer);
    for (const extra of Array.isArray(p.also_refs) ? p.also_refs : []) {
      const o = typeof extra === "string" ? seen.get(extra.trim()) : undefined;
      if (o) addSource(o);
    }
    const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s*[—–]\s*/g, ", ").trim().slice(0, max) : "");
    out.push({
      rank: out.length + 1,
      label: text(p.label, 40) || (over ? "stretch" : ""),
      title: offer.title,
      why: text(p.why, 400),
      price_cents: offer.price_cents,
      currency: offer.currency,
      store: offer.store,
      url: offer.url,
      in_stock: offer.in_stock,
      stretch: over,
      sources,
    });
  }
  return out;
}

export interface ScoutOutcome {
  picks: ScoutPickDraft[];
  storesChecked: number;
  error: string | null;
}

/** The research loop itself. Pure apart from its deps, so tests drive it with a scripted model. */
export async function runScoutAgent(
  brief: ScoutBrief,
  group: Group,
  deps: Required<Pick<ScoutDeps, "llm" | "search">> & { brain: AssistantBrain; now?: () => number },
): Promise<ScoutOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const currency = sourceContext(group).currency;
  const system = scoutSystemPrompt(brief, group, currency);
  const messages: ChatMessage[] = [{ role: "user", content: "Research this brief and submit your picks." }];
  const seen = new Map<string, FoundOffer>();
  const stores = new Set<string>();
  let searches = 0;
  let nudged = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const late = now() - started > RUN_DEADLINE_MS || step === MAX_STEPS - 1;
    const reply = await deps.llm({
      model: deps.brain.chatModel,
      system,
      messages,
      tools: late ? SCOUT_TOOLS.filter((t) => t.name === "submit_picks") : SCOUT_TOOLS,
      maxTokens: 1500,
    });
    messages.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls });

    if (!reply.toolCalls.length) {
      if (nudged || !seen.size) break;
      nudged = true;
      messages.push({ role: "user", content: "Call submit_picks now with your best picks from the offers you found." });
      continue;
    }

    for (const call of reply.toolCalls) {
      if (call.name === "submit_picks") {
        const picks = draftPicks(call.args, seen, brief);
        if (picks.length) return { picks, storesChecked: stores.size, error: null };
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: "None of those picks used an offer_ref from a search (or an over-budget pick wasn't marked stretch). Pick from the refs you were given.",
        });
        continue;
      }
      if (call.name !== "search_prices") {
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: "Unknown tool." });
        continue;
      }
      const query = typeof call.args.query === "string" ? call.args.query.trim().slice(0, 120) : "";
      if (!query || searches >= MAX_SEARCHES || late) {
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: "No more searches. Submit your picks now." });
        continue;
      }
      searches++;
      const offers = (await deps.search(query)).slice(0, OFFERS_PER_SEARCH);
      const lines = offers.map((o) => {
        const ref = `o${seen.size + 1}`;
        seen.set(ref, o);
        stores.add(o.store.toLowerCase());
        const stock = o.in_stock === true ? "in stock" : o.in_stock === false ? "out of stock" : "stock unknown";
        return `${ref}: ${o.title} | ${o.store} | ${money(o.price_cents, o.currency)} | ${stock}`;
      });
      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: lines.length ? lines.join("\n") : `No offers matched "${query}". Try a different product or a shorter search.`,
      });
    }
  }
  return {
    picks: [],
    storesChecked: stores.size,
    error: seen.size ? "Scout couldn't settle on picks this time. Try again, or say a bit more about what matters." : "Scout couldn't find prices for that. Try naming the kind of thing or a brand.",
  };
}

/** Runs a started search to the end and saves its picks. Never throws: a failure lands on the row. */
export async function completeScout(admin: SupabaseClient, search: ShopperSearch, group: Group, brain: AssistantBrain, deps: ScoutDeps = {}): Promise<void> {
  const finish = async (fields: Partial<ShopperSearch>) => {
    const { error } = await admin
      .from("shopper_searches")
      .update({ ...fields, finished_at: new Date().toISOString() })
      .eq("id", search.id);
    if (error) console.error("[scout] could not finish run", search.id, error.message);
  };
  try {
    const outcome = await runScoutAgent(search.brief, group, {
      brain,
      llm: deps.llm ?? llmClient(brain.connection),
      search: deps.search ?? sourceSearch(group, search.brief),
      now: deps.now,
    });
    if (!outcome.picks.length) {
      await finish({ status: "failed", error: outcome.error, stores_checked: outcome.storesChecked });
      return;
    }
    const { error } = await admin
      .from("shopper_picks")
      .insert(outcome.picks.map((p) => ({ ...p, group_id: search.group_id, search_id: search.id })));
    if (error) throw new Error(error.message);
    await finish({ status: "done", error: null, stores_checked: outcome.storesChecked });
  } catch (err) {
    console.error("[scout] run failed", search.id, err instanceof Error ? err.message : err);
    await finish({ status: "failed", error: "Scout hit a problem talking to the AI model. Try again in a minute." });
  }
}

/** One run and its live picks, best first. */
export async function readRun(admin: SupabaseClient, id: string): Promise<{ search: ShopperSearch | null; picks: ShopperPick[] }> {
  const [{ data: search }, { data: picks }] = await Promise.all([
    admin.from("shopper_searches").select("*").eq("id", id).eq("deleted", false).maybeSingle(),
    admin.from("shopper_picks").select("*").eq("search_id", id).eq("deleted", false).order("rank", { ascending: true }),
  ]);
  return { search: (search as ShopperSearch | null) ?? null, picks: (picks ?? []) as ShopperPick[] };
}

/**
 * Watches a pick: a watchlist item for the product, linked to its run, with
 * the brief's budget and deadline, and the pick marked with it. Watching the
 * same pick twice returns the first item.
 */
export async function watchPick(admin: SupabaseClient, pick: ShopperPick, search: ShopperSearch, userId: string): Promise<ShopperWant> {
  if (pick.want_id) {
    const { data } = await admin.from("shopper_wants").select("*").eq("id", pick.want_id).eq("deleted", false).maybeSingle();
    if (data) return data as ShopperWant;
  }
  const { data, error } = await admin
    .from("shopper_wants")
    .insert({
      group_id: pick.group_id,
      title: pick.title.slice(0, 120),
      query: null,
      budget_cents: search.brief.budget_max_cents,
      target_cents: null,
      need_by: search.brief.need_by,
      notes: pick.why || null,
      status: "watching",
      search_id: search.id,
      created_by: userId,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Could not add it to the watchlist: ${error?.message ?? "no row"}`);
  await admin.from("shopper_picks").update({ want_id: (data as ShopperWant).id }).eq("id", pick.id);
  return data as ShopperWant;
}
