import { beforeEach, describe, expect, it, vi } from "vitest";

// Archiving, deleting and restoring a Scout search. Any member of the
// household may, the change covers the whole thread, and a deleted search can
// still be found so its delete can be taken back.
type Row = { id: string; group_id: string; thread_id: string | null };
let rows: Row[] = [];
const updates: { patch: Record<string, unknown>; group: unknown; or: string }[] = [];
const admin = {
  from: () => ({
    select: () => ({
      eq: (_col: string, id: string) => ({ maybeSingle: async () => ({ data: rows.find((r) => r.id === id) ?? null }) }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: (_col: string, group: unknown) => ({
        or: async (or: string) => {
          updates.push({ patch, group, or });
          return { error: null };
        },
      }),
    }),
  }),
};
vi.mock("@/lib/shopper/route-helpers", () => ({
  shopperRequest: async () => ({ admin, userId: "u1", group: { id: "g1" }, want: null }),
}));
vi.mock("@/lib/shopper/scout", () => ({ readRun: vi.fn() }));
vi.mock("@/lib/shopper/scout-thread", () => ({ readThread: vi.fn() }));

import { PATCH } from "./route";

const patch = (id: string, body: unknown) =>
  PATCH(new Request(`https://x/api/shopper/scout/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  rows = [
    { id: "root", group_id: "g1", thread_id: null },
    { id: "refined", group_id: "g1", thread_id: "root" },
    { id: "theirs", group_id: "g2", thread_id: null },
  ];
  updates.length = 0;
});

describe("PATCH /api/shopper/scout/:id", () => {
  it("archives the whole thread", async () => {
    const res = await patch("root", { archived: true });
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].group).toBe("g1");
    expect(updates[0].or).toBe("id.eq.root,thread_id.eq.root");
    expect(typeof updates[0].patch.archived_at).toBe("string");
  });

  it("acts on the thread from a refined run", async () => {
    await patch("refined", { deleted: true });
    expect(updates[0]).toMatchObject({ patch: { deleted: true }, or: "id.eq.root,thread_id.eq.root" });
  });

  it("restores and unarchives", async () => {
    await patch("root", { deleted: false, archived: false });
    expect(updates[0].patch).toEqual({ deleted: false, archived_at: null });
  });

  it("refuses another household's search", async () => {
    const res = await patch("theirs", { archived: true });
    expect(res.status).toBe(404);
    expect(updates).toHaveLength(0);
  });

  it("needs something to change", async () => {
    const res = await patch("root", { title: "x" });
    expect(res.status).toBe(400);
  });
});
