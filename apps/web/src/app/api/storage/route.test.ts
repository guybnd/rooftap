import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The household boundary for files in R2 (.docs/r2-storage.md): a caller only
// gets a link for a path whose first segment is a group they belong to,
// mirroring the HOUP-291 Supabase bucket policies.

const getSessionUserMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({ getSessionUser: getSessionUserMock }));

// group_members rows the fake admin client knows about: "user:group".
let memberships = new Set<string>();
// group_entitlements rows by group id.
let usedBytes = 0;
let entitlements: Record<string, { plan: string; plan_expires_at: string | null; billing_exempt: boolean }> = {};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: usedBytes, error: null }),
    from: (table: string) => {
      const filters: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return q;
        },
        maybeSingle: async () => {
          if (table === "group_entitlements") return { data: entitlements[filters.group_id] ?? null, error: null };
          return {
            data: memberships.has(`${filters.user_id}:${filters.group_id}`) ? { user_id: filters.user_id } : null,
            error: null,
          };
        },
      };
      return q;
    },
  }),
}));

const r2ExistsMock = vi.fn();
const r2DeleteMock = vi.fn();
let r2Configured = true;
vi.mock("@/lib/r2-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2-storage")>();
  return {
    ...actual,
    getR2Config: () => (r2Configured ? { accountId: "acct", accessKeyId: "a", secretAccessKey: "s", bucket: "homeup" } : null),
    r2Exists: (...args: unknown[]) => r2ExistsMock(...args),
    r2Delete: (...args: unknown[]) => r2DeleteMock(...args),
  };
});

const MINE = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";

function req(body: unknown): Request {
  return new Request("https://example.com/api/storage", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function call(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST(req(body));
  return { status: res.status, json: await res.json() };
}

// The first import pulls in next/server and core; keep it out of the per-test timeout.
beforeAll(async () => {
  await import("./route");
}, 30_000);

beforeEach(() => {
  vi.clearAllMocks();
  r2Configured = true;
  memberships = new Set([`me:${MINE}`]);
  entitlements = {};
  usedBytes = 0;
  getSessionUserMock.mockResolvedValue({ id: "me" });
  r2ExistsMock.mockResolvedValue(true);
});

describe("POST /api/storage", () => {
  it("401s without a signed-in user", async () => {
    getSessionUserMock.mockResolvedValue(null);
    expect((await call({ op: "view", bucket: "documents", path: `${MINE}/d/f.pdf` })).status).toBe(401);
  });

  it("gives a member a link to their own household's file", async () => {
    const { status, json } = await call({ op: "view", bucket: "documents", path: `${MINE}/d/f.pdf` });
    expect(status).toBe(200);
    expect(json.provider).toBe("r2");
    expect(json.url).toContain(`/homeup/documents/${MINE}/d/f.pdf?`);
  });

  it.each(["view", "upload", "delete"])("refuses %s on another household's path", async (op) => {
    const { status, json } = await call({ op, bucket: "documents", path: `${THEIRS}/d/f.pdf`, mimeType: "application/pdf", sizeBytes: 10 });
    expect(status).toBe(404);
    expect(json.url).toBeUndefined();
    expect(r2ExistsMock).not.toHaveBeenCalled();
    expect(r2DeleteMock).not.toHaveBeenCalled();
  });

  it.each([
    `${MINE}/../${THEIRS}/d/f.pdf`,
    `/${THEIRS}/d/f.pdf`,
    `not-a-group/d/f.pdf`,
    `${MINE}`,
    `${MINE}\\..\\${THEIRS}/f.pdf`,
  ])("rejects a path that could escape the household prefix: %s", async (path) => {
    const { status, json } = await call({ op: "view", bucket: "documents", path });
    expect(status).toBe(400);
    expect(json.url).toBeUndefined();
  });

  it("only signs uploads of allowed types within the size cap", async () => {
    const path = `${MINE}/d/f.pdf`;
    expect((await call({ op: "upload", bucket: "documents", path, mimeType: "text/html", sizeBytes: 10 })).status).toBe(400);
    expect((await call({ op: "upload", bucket: "documents", path, mimeType: "application/pdf", sizeBytes: 0 })).status).toBe(400);
    expect((await call({ op: "upload", bucket: "documents", path, mimeType: "application/pdf", sizeBytes: 21 * 1024 * 1024 })).json).toEqual({
      provider: "refused",
      error: "File is too large (max 20 MB).",
    });
    const ok = await call({ op: "upload", bucket: "documents", path, mimeType: "application/pdf", sizeBytes: 10 });
    expect(ok.json.provider).toBe("r2");
    expect(ok.json.url).toContain("X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost");
  });

  it("lets a comped household upload far bigger files", async () => {
    entitlements[MINE] = { plan: "free", plan_expires_at: null, billing_exempt: true };
    const path = `${MINE}/d/f.pdf`;
    const big = await call({ op: "upload", bucket: "documents", path, mimeType: "application/pdf", sizeBytes: 3 * 1024 ** 3 });
    expect(big.json.provider).toBe("r2");
    const tooBig = await call({ op: "upload", bucket: "documents", path, mimeType: "application/pdf", sizeBytes: 6 * 1024 ** 3 });
    expect(tooBig.json).toEqual({ provider: "refused", error: "File is too large (max 5 GB)." });
  });

  it("refuses an upload that would take a household past its storage total", async () => {
    usedBytes = 2 * 1024 ** 3 - 1024;
    const res = await call({ op: "upload", bucket: "documents", path: `${MINE}/d/f.pdf`, mimeType: "application/pdf", sizeBytes: 2048 });
    expect(res.json).toEqual({
      provider: "refused",
      error: "Your household's 2 GB of document storage is full. Delete some documents to make room.",
    });
  });

  it("never applies a storage total to a comped household", async () => {
    entitlements[MINE] = { plan: "free", plan_expires_at: null, billing_exempt: true };
    usedBytes = 500 * 1024 ** 3;
    const res = await call({ op: "upload", bucket: "documents", path: `${MINE}/d/f.pdf`, mimeType: "application/pdf", sizeBytes: 2048 });
    expect(res.json.provider).toBe("r2");
  });

  it("gives Plus households the Plus cap", async () => {
    entitlements[MINE] = { plan: "plus", plan_expires_at: null, billing_exempt: false };
    const res = await call({ op: "upload", bucket: "documents", path: `${MINE}/d/f.pdf`, mimeType: "application/pdf", sizeBytes: 500 * 1024 * 1024 });
    expect(res.json.provider).toBe("r2");
  });

  it("sends the client to Supabase when the file has no R2 copy", async () => {
    r2ExistsMock.mockResolvedValue(false);
    expect((await call({ op: "view", bucket: "documents", path: `${MINE}/d/f.pdf` })).json).toEqual({ provider: "supabase" });
  });

  it("never hands out R2 links for buckets that aren't on R2", async () => {
    const { json } = await call({ op: "view", bucket: "cost-documents", path: `${MINE}/f.pdf` });
    expect(json).toEqual({ provider: "supabase" });
  });

  it("tells clients R2 is off when it isn't configured", async () => {
    r2Configured = false;
    expect((await call({ op: "view", bucket: "documents", path: `${MINE}/d/f.pdf` })).json).toEqual({ provider: "supabase", r2: false });
  });
});
