import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/assistant/service", () => ({
  assistantRequest: vi.fn(async () => ({ userId: "u1", groupId: "g1" })),
  assistantErrorResponse: (status: number, error: string) => Response.json({ error }, { status }),
  decideProposal: vi.fn(async () => ({ ok: true, message: { id: "m1" }, outcome: null })),
}));

import { decideProposal } from "@/lib/assistant/service";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/assistant/proposals/m1", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "m1" }),
  });

describe("POST /api/assistant/proposals/[id]", () => {
  beforeEach(() => vi.mocked(decideProposal).mockClear());

  it("confirms only the picked rows, with their new names", async () => {
    const res = await post({ decision: "pick", picks: [{ key: "0.1", text: "Candles" }, { key: "1" }] });
    expect(res.status).toBe(200);
    expect(decideProposal).toHaveBeenCalledWith(expect.anything(), "m1", "confirm", [{ key: "0.1", text: "Candles" }, { key: "1" }]);
  });

  it("keeps a plain confirm as all of it", async () => {
    await post({ decision: "confirm" });
    expect(decideProposal).toHaveBeenCalledWith(expect.anything(), "m1", "confirm", undefined);
  });

  it("refuses picks it can't read", async () => {
    for (const picks of [undefined, "0", [{ key: "x" }], [{ key: "0", text: 5 }]]) {
      expect((await post({ decision: "pick", picks })).status).toBe(400);
    }
    expect(decideProposal).not.toHaveBeenCalled();
  });
});
