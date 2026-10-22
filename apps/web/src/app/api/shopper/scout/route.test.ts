import { beforeEach, describe, expect, it, vi } from "vitest";

// HOUP-435: starting a Scout run. Blocked plans get the shared AI codes, a
// server with nothing to search says so, and a started run answers at once
// while the research carries on after the response.
const afterMock = vi.fn();
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => afterMock(fn) }));

const inserted: Record<string, unknown>[] = [];
const admin = {
  from: () => ({
    insert: (row: Record<string, unknown>) => {
      inserted.push(row);
      return { select: () => ({ single: async () => ({ data: { id: row.id ?? "s1", ...row }, error: null }) }) };
    },
  }),
};
vi.mock("@/lib/shopper/route-helpers", () => ({
  shopperRequest: async () => ({ admin, userId: "u1", group: { id: "g1" }, want: null }),
}));

let decided: unknown = { brain: { keySource: "household" } };
let sources = true;
const completeScout = vi.fn();
// startScoutRun's own insert and after() hand-off, with completeScout spied.
vi.mock("@/lib/shopper/scout", () => ({
  scoutBrain: async () => decided,
  hasOfferSources: async () => sources,
  startScoutRun: async (a: typeof admin, group: { id: string }, userId: string, brief: unknown, brain: { keySource: string }, opts: { id?: string } = {}) => {
    const { data } = await a
      .from()
      .insert({ ...(opts.id ? { id: opts.id } : {}), group_id: group.id, brief, status: "running", key_source: brain.keySource, created_by: userId })
      .select()
      .single();
    afterMock(() => completeScout(data));
    return data;
  },
}));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("https://x/api/shopper/scout", { method: "POST", body: JSON.stringify(body) }));
const ID = "7b0a3c52-6f0e-4f39-9d55-0a4c6a1b2c3d";

beforeEach(() => {
  inserted.length = 0;
  afterMock.mockReset();
  completeScout.mockReset();
  decided = { brain: { keySource: "household" } };
  sources = true;
});

describe("POST /api/shopper/scout", () => {
  it("rejects an empty brief", async () => {
    expect((await post({ text: "" })).status).toBe(400);
  });

  it("answers 402 with the shared code when the plan has no AI", async () => {
    decided = { blocked: "ai_requires_plus" };
    const res = await post({ text: "A kettle" });
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("ai_requires_plus");
    expect(inserted).toEqual([]);
  });

  it("says so when there is nothing to search", async () => {
    sources = false;
    expect((await post({ text: "A kettle" })).status).toBe(503);
  });

  it("saves the run with the app's id and researches after answering", async () => {
    const res = await post({ id: ID, text: "A kettle", budget_max_cents: 8000 });
    expect(res.status).toBe(202);
    expect(inserted[0]).toMatchObject({ id: ID, group_id: "g1", status: "running", key_source: "household", created_by: "u1" });
    expect(completeScout).not.toHaveBeenCalled();
    await afterMock.mock.calls[0][0]();
    expect(completeScout).toHaveBeenCalledOnce();
  });

  it("ignores an id that isn't a uuid", async () => {
    await post({ id: "'; drop", text: "A kettle" });
    expect(inserted[0]).not.toHaveProperty("id");
  });
});
