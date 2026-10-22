import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import type { Group, ScoutBrief, ScoutThread, ShopperPick, ShopperSearch } from "@homeup/core";
import type { AssistantBrain } from "@/lib/assistant/provider";
import type { LlmClient, LlmRequest, LlmStep } from "@/lib/assistant/llm";
import { followUpSystemPrompt, refinedBrief, runFollowUp } from "./scout-thread";
import type { FoundOffer } from "./scout";

const brief: ScoutBrief = { text: "Microwave, 25L", budget_min_cents: null, budget_max_cents: 12000, need_by: null, where: ["nearby", "online"] };
const group = { id: "g", region: "AU", currency: "AUD", home_lat: null, home_lng: null } as unknown as Group;
const brain = { chatModel: "m", keySource: "server" } as AssistantBrain;

const run: ShopperSearch = {
  id: "r1",
  group_id: "g",
  brief,
  status: "done",
  error: null,
  stores_checked: 15,
  key_source: "server",
  created_by: "u",
  created_at: "2026-10-22T01:00:00Z",
  updated_at: "2026-10-22T01:00:00Z",
  finished_at: "2026-10-22T01:01:00Z",
  thread_id: null,
  deleted: false,
};

const pick = (rank: number, title: string, price: number): ShopperPick => ({
  id: `p${rank}`,
  group_id: "g",
  search_id: "r1",
  rank,
  label: "best value",
  title,
  why: "Fits.",
  price_cents: price,
  currency: "AUD",
  store: "DMS Appliances",
  url: null,
  in_stock: true,
  stretch: price > 12000,
  sources: [],
  want_id: null,
  created_at: "",
  updated_at: "",
  deleted: false,
});

const thread: ScoutThread = { runs: [run], picks: [pick(1, "LG NeoChef 25L", 14500), pick(2, "Panasonic NN-ST34NB", 15900)], messages: [] };

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

const noSearch = async (): Promise<FoundOffer[]> => [];

describe("followUpSystemPrompt", () => {
  it("lists the picks by number, flags over-budget ones and names the pick asked about", () => {
    const prompt = followUpSystemPrompt(thread, group, "AUD", thread.picks[1], "2026-10-22");
    expect(prompt).toContain("Latest search");
    expect(prompt).toContain("2. Panasonic NN-ST34NB | DMS Appliances | A$159 | in stock | over budget");
    expect(prompt).toContain("They are asking about pick 2 from the latest search");
  });
});

describe("runFollowUp", () => {
  it("answers a question in words, without em-dashes", async () => {
    const { llm, requests } = scripted([step({ text: "Pick 1 is the better value — it has sensor cooking." })]);
    const out = await runFollowUp(thread, { text: "Is 2 worth it?", pick: null }, group, { brain, llm, search: noSearch });
    expect(out).toEqual({ kind: "answer", text: "Pick 1 is the better value, it has sensor cooking." });
    expect(requests[0].messages.at(-1)).toEqual({ role: "user", content: "Is 2 worth it?" });
    expect(requests[0].tools.map((t) => t.name)).toEqual(["search_prices", "search_again"]);
  });

  it("can check a price before answering, at most twice", async () => {
    const search = vi.fn(async () => [{ store: "JB Hi-Fi", title: "LG NeoChef 25L", url: null, price_cents: 13900, currency: "AUD", in_stock: true, source_id: "s", distance_m: null }]);
    const { llm, requests } = scripted([
      step({ toolCalls: [{ id: "a", name: "search_prices", args: { query: "LG NeoChef" } }, { id: "b", name: "search_prices", args: { query: "LG" } }, { id: "c", name: "search_prices", args: { query: "x" } }] }),
      step({ text: "JB Hi-Fi has pick 1 for $139." }),
    ]);
    const out = await runFollowUp(thread, { text: "Cheaper anywhere?", pick: null }, group, { brain, llm, search });
    expect(search).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ kind: "answer", text: "JB Hi-Fi has pick 1 for $139." });
    const results = requests[1].messages.filter((m) => m.role === "tool");
    expect(results.map((m) => m.role === "tool" && m.content)).toEqual([
      "LG NeoChef 25L | JB Hi-Fi | A$139 | in stock",
      "LG NeoChef 25L | JB Hi-Fi | A$139 | in stock",
      "No more price checks. Answer with what you have.",
    ]);
  });

  it("turns a change into a refined brief that keeps what didn't change", async () => {
    const { llm } = scripted([
      step({ toolCalls: [{ id: "a", name: "search_again", args: { text: "Microwave, 25L, with a grill", budget_max: 160, summary: "with a grill" } }] }),
    ]);
    const out = await runFollowUp(thread, { text: "Up to $160 but it needs a grill", pick: null }, group, { brain, llm, search: noSearch });
    expect(out).toEqual({
      kind: "refine",
      summary: "with a grill",
      brief: { text: "Microwave, 25L, with a grill", budget_min_cents: null, budget_max_cents: 16000, need_by: null, where: ["nearby", "online"] },
    });
  });

  it("sends the thread so far with the new question", async () => {
    const { llm, requests } = scripted([step({ text: "Yes." })]);
    const withHistory: ScoutThread = {
      ...thread,
      messages: [
        { id: "m1", group_id: "g", thread_id: "r1", role: "user", text: "Why nothing under $120?", pick_id: null, search_id: null, created_by: "u", created_at: "1", updated_at: "1", deleted: false },
        { id: "m2", group_id: "g", thread_id: "r1", role: "scout", text: "25L inverters start at $139.", pick_id: null, search_id: null, created_by: "u", created_at: "2", updated_at: "2", deleted: false },
      ],
    };
    await runFollowUp(withHistory, { text: "Would 20L do?", pick: null }, group, { brain, llm, search: noSearch });
    expect(requests[0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("refinedBrief", () => {
  it("clears a budget on zero and keeps it when absent", () => {
    expect(refinedBrief({ budget_max: 0 }, brief)?.budget_max_cents).toBeNull();
    expect(refinedBrief({}, brief)).toEqual(brief);
    expect(refinedBrief({ where: ["secondhand"], need_by: "2026-11-01" }, brief)).toMatchObject({ where: ["secondhand"], need_by: "2026-11-01" });
  });
});
