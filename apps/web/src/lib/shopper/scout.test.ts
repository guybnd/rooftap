import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import type { Group, ScoutBrief } from "@homeup/core";
import type { AssistantBrain } from "@/lib/assistant/provider";
import type { LlmClient, LlmRequest, LlmStep } from "@/lib/assistant/llm";
import { completeScout, draftPicks, runScoutAgent, scoutPushPayload, scoutSystemPrompt, type FoundOffer } from "./scout";
import type { ShopperSearch } from "@homeup/core";

const brief: ScoutBrief = { text: "A 65 inch OLED for the lounge", budget_min_cents: null, budget_max_cents: 200000, need_by: null, where: ["nearby", "online"] };
const group = { id: "g", region: "AU", currency: "AUD", home_lat: null, home_lng: null } as unknown as Group;
const brain = { chatModel: "m", keySource: "server" } as AssistantBrain;

const offer = (store: string, price: number, title = "LG C4 65 OLED"): FoundOffer => ({
  store,
  title,
  url: `https://${store.toLowerCase().replace(/\s/g, "")}.example/tv`,
  price_cents: price,
  currency: "AUD",
  in_stock: true,
  source_id: "serpapi",
  distance_m: null,
});

const step = (over: Partial<LlmStep>): LlmStep => ({ text: "", toolCalls: [], inputTokens: 0, outputTokens: 0, ...over });

function scripted(steps: LlmStep[]): { llm: LlmClient; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    llm: async (req) => {
      requests.push(structuredClone(req));
      return steps.shift() ?? step({ text: "done" });
    },
  };
}

describe("draftPicks", () => {
  const seen = new Map([
    ["o1", offer("JB Hi-Fi", 189900)],
    ["o2", offer("Harvey Norman", 249900)],
    ["o3", offer("The Good Guys", 194900)],
  ]);

  it("keeps only picks that point at an offer from this run, with that offer's price and store", () => {
    const picks = draftPicks({ picks: [{ offer_ref: "o9", label: "x", why: "y" }, { offer_ref: "o1", label: "best value", why: "Fits.", also_refs: ["o3"] }] }, seen, brief);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ rank: 1, store: "JB Hi-Fi", price_cents: 189900, stretch: false });
    expect(picks[0].sources.map((s) => s.title)).toEqual(["JB Hi-Fi", "The Good Guys"]);
  });

  it("drops an over-budget pick unless it is marked stretch", () => {
    expect(draftPicks({ picks: [{ offer_ref: "o2", label: "best", why: "Big." }] }, seen, brief)).toEqual([]);
    const [p] = draftPicks({ picks: [{ offer_ref: "o2", label: "", why: "Worth it for the brightness.", stretch: true }] }, seen, brief);
    expect(p).toMatchObject({ stretch: true, label: "stretch" });
  });

  it("caps at three, skips repeats and strips em-dashes from copy", () => {
    const many = { picks: ["o1", "o1", "o3", "o1", "o2"].map((r) => ({ offer_ref: r, label: "a", why: "Good — really", stretch: true })) };
    const picks = draftPicks(many, seen, brief);
    expect(picks.map((p) => p.store)).toEqual(["JB Hi-Fi", "The Good Guys", "Harvey Norman"]);
    expect(picks[0].why).toBe("Good, really");
  });
});

describe("runScoutAgent", () => {
  it("searches, then submits picks from the offers it saw", async () => {
    const { llm, requests } = scripted([
      step({ toolCalls: [{ id: "c1", name: "search_prices", args: { query: "LG C4 65" } }] }),
      step({ toolCalls: [{ id: "c2", name: "submit_picks", args: { picks: [{ offer_ref: "o1", label: "best value", why: "Under budget and in stock." }] } }] }),
    ]);
    const search = vi.fn(async () => [offer("JB Hi-Fi", 189900), offer("Bing Lee", 199500)]);
    const out = await runScoutAgent(brief, group, { brain, llm, search });
    expect(search).toHaveBeenCalledWith("LG C4 65");
    expect(out.error).toBeNull();
    expect(out.storesChecked).toBe(2);
    expect(out.picks[0]).toMatchObject({ store: "JB Hi-Fi", price_cents: 189900 });
    const toolResult = requests[1].messages.find((m) => m.role === "tool");
    expect(toolResult?.role === "tool" && toolResult.content).toContain("o1: LG C4 65 OLED | JB Hi-Fi | A$1,899 | in stock");
  });

  it("tells the model when its picks don't use a ref, and lets it try again", async () => {
    const { llm, requests } = scripted([
      step({ toolCalls: [{ id: "c1", name: "search_prices", args: { query: "LG C4" } }] }),
      step({ toolCalls: [{ id: "c2", name: "submit_picks", args: { picks: [{ offer_ref: "made-up", label: "a", why: "b" }] } }] }),
      step({ toolCalls: [{ id: "c3", name: "submit_picks", args: { picks: [{ offer_ref: "o1", label: "a", why: "b" }] } }] }),
    ]);
    const out = await runScoutAgent(brief, group, { brain, llm, search: async () => [offer("JB Hi-Fi", 189900)] });
    expect(out.picks).toHaveLength(1);
    expect(JSON.stringify(requests[2].messages)).toContain("None of those picks used an offer_ref");
  });

  it("fails with words for the person when nothing was found", async () => {
    const { llm } = scripted([step({ toolCalls: [{ id: "c1", name: "search_prices", args: { query: "zzz" } }] }), step({ text: "Nothing." })]);
    const out = await runScoutAgent(brief, group, { brain, llm, search: async () => [] });
    expect(out.picks).toEqual([]);
    expect(out.error).toMatch(/couldn't find prices/);
  });

  it("only offers submit_picks once the run is out of time", async () => {
    let t = 0;
    const { llm, requests } = scripted([
      step({ toolCalls: [{ id: "c1", name: "search_prices", args: { query: "LG C4" } }] }),
      step({ toolCalls: [{ id: "c2", name: "submit_picks", args: { picks: [{ offer_ref: "o1", label: "a", why: "b" }] } }] }),
    ]);
    const search = async () => {
      t += 60_000;
      return [offer("JB Hi-Fi", 189900)];
    };
    await runScoutAgent(brief, group, { brain, llm, search, now: () => t });
    expect(requests[0].tools.map((x) => x.name)).toEqual(["search_prices", "submit_picks"]);
    expect(requests[1].tools.map((x) => x.name)).toEqual(["submit_picks"]);
  });
});

describe("scoutSystemPrompt", () => {
  it("states the budget, deadline and where in the household's currency", () => {
    const prompt = scoutSystemPrompt({ ...brief, budget_min_cents: 150000, need_by: "2026-11-01", where: ["secondhand"] }, group, "AUD", "2026-10-21");
    expect(prompt).toContain("Budget: A$1,500 to A$2,000. Need by: 2026-11-01. Where they'll buy: Second hand.");
    expect(prompt).toContain("Brief: A 65 inch OLED for the lounge");
  });
});

describe("run-finished push (HOUP-464)", () => {
  const search = { id: "s1", group_id: "g", brief, created_by: "u1" } as ShopperSearch;
  const admin = {
    from: () => ({
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  } as unknown as Parameters<typeof completeScout>[0];

  it("says how many picks, under what budget, and opens the run", () => {
    expect(scoutPushPayload(search, { picks: 3, failed: false }, "AUD")).toEqual({
      title: "Scout found 3 picks",
      body: "A 65 inch OLED for the lounge, under A$2,000",
      url: "/shopper/scout/s1",
      tag: "scout-s1",
    });
    expect(scoutPushPayload(search, { picks: 0, failed: true }, "AUD").title).toBe("Scout didn't finish");
  });

  it("tells whoever asked when the run finishes, and only them", async () => {
    const push = vi.fn(async () => ({ sent: 1, pruned: 0 }));
    const { llm } = scripted([
      step({ toolCalls: [{ id: "c1", name: "search_prices", args: { query: "LG C4" } }] }),
      step({ toolCalls: [{ id: "c2", name: "submit_picks", args: { picks: [{ offer_ref: "o1", label: "a", why: "b" }] } }] }),
    ]);
    await completeScout(admin, search, group, brain, { llm, search: async () => [offer("JB Hi-Fi", 189900)], push });
    expect(push).toHaveBeenCalledWith(admin, ["u1"], expect.objectContaining({ title: "Scout found 1 pick" }));
  });

  it("still tells them when it fails, and a push failure never breaks the run", async () => {
    const push = vi.fn(async () => {
      throw new Error("down");
    });
    const { llm } = scripted([step({ text: "nothing" })]);
    await expect(completeScout(admin, search, group, brain, { llm, search: async () => [], push })).resolves.toBeUndefined();
    expect(push).toHaveBeenCalledWith(admin, ["u1"], expect.objectContaining({ title: "Scout didn't finish" }));
  });
});
