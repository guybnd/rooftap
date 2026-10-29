import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the people who run the server hear about a server update.
const getSessionUserMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({ getSessionUser: () => getSessionUserMock() }));

let owners = 0;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const q = { select: () => q, eq: () => q, then: (resolve: (v: unknown) => void) => resolve({ count: owners, error: null }) };
    return { from: () => q };
  },
}));

const serverUpdateMock = vi.fn();
vi.mock("@/lib/server-update", () => ({ serverUpdate: () => serverUpdateMock() }));
const readUpdaterMock = vi.fn();
vi.mock("@/lib/server-updater", () => ({ readServerUpdater: () => readUpdaterMock() }));

const UPDATER = { installed: true, pending: false, pendingSince: null, status: null };
const UPDATE = { current: "1.1.3", latest: "1.2.0", url: "https://github.com/guybnd/rooftap/releases/tag/v1.2.0" };

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("SERVER_OPERATOR_EMAILS", "");
  getSessionUserMock.mockResolvedValue({ id: "u1", email: "me@example.com" });
  serverUpdateMock.mockReset().mockResolvedValue(UPDATE);
  readUpdaterMock.mockReset().mockResolvedValue(UPDATER);
  owners = 0;
});

describe("GET /api/server-update", () => {
  it("needs a sign-in", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(401);
  });

  it("tells a server operator", async () => {
    vi.stubEnv("SERVER_OPERATOR_EMAILS", "me@example.com");
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toEqual({ update: UPDATE, updater: UPDATER });
  });

  it("tells nobody else on a server with operators, and asks GitHub nothing", async () => {
    vi.stubEnv("SERVER_OPERATOR_EMAILS", "admin@example.com");
    owners = 1;
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toEqual({ update: null, updater: null });
    expect(serverUpdateMock).not.toHaveBeenCalled();
    expect(readUpdaterMock).not.toHaveBeenCalled();
  });

  it("tells household owners on a server with no operators, but not members", async () => {
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toEqual({ update: null, updater: null });
    owners = 1;
    expect(await (await GET()).json()).toEqual({ update: UPDATE, updater: UPDATER });
  });
});
