import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the people who run the server can start an update, only to the
// newest release, and only when the updater is on and idle.
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
const requestMock = vi.fn();
vi.mock("@/lib/server-updater", () => ({
  readServerUpdater: () => readUpdaterMock(),
  requestServerUpdate: (v: string) => requestMock(v),
}));

// Imported once, up front: a first import inside a test can outlast the
// test's time limit on a busy machine.
import { POST } from "./route";

const UPDATE = { current: "1.1.3", latest: "1.2.0", url: "https://github.com/guybnd/rooftap/releases/tag/v1.2.0" };
const IDLE = { installed: true, pending: false, pendingSince: null, status: null };

function post(body: unknown) {
  return new Request("http://localhost/api/server-update/install", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("SERVER_OPERATOR_EMAILS", "me@example.com");
  getSessionUserMock.mockResolvedValue({ id: "u1", email: "me@example.com" });
  serverUpdateMock.mockReset().mockResolvedValue(UPDATE);
  readUpdaterMock.mockReset().mockResolvedValue(IDLE);
  requestMock.mockReset().mockResolvedValue(true);
  owners = 0;
});

describe("POST /api/server-update/install", () => {
  it("needs a sign-in", async () => {
    getSessionUserMock.mockResolvedValue(null);
    expect((await POST(post({ version: "1.2.0" }))).status).toBe(401);
  });

  it("refuses anyone who does not run the server", async () => {
    vi.stubEnv("SERVER_OPERATOR_EMAILS", "admin@example.com");
    owners = 1;
    expect((await POST(post({ version: "1.2.0" }))).status).toBe(403);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("asks the updater for the newest release", async () => {
    const res = await POST(post({ version: "1.2.0" }));
    expect(res.status).toBe(202);
    expect(requestMock).toHaveBeenCalledWith("1.2.0");
  });

  it("refuses any other version", async () => {
    for (const version of ["1.1.9", "1.2.0; rm -rf /", "", 120]) {
      expect((await POST(post({ version }))).status).toBe(409);
    }
    serverUpdateMock.mockResolvedValue(null);
    expect((await POST(post({ version: "1.2.0" }))).status).toBe(409);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("refuses when the updater is off or already busy", async () => {
    readUpdaterMock.mockResolvedValue(null);
    expect((await POST(post({ version: "1.2.0" }))).status).toBe(409);
    readUpdaterMock.mockResolvedValue({ ...IDLE, installed: false });
    expect((await POST(post({ version: "1.2.0" }))).status).toBe(409);
    readUpdaterMock.mockResolvedValue({ ...IDLE, pending: true, pendingSince: new Date().toISOString() });
    expect((await POST(post({ version: "1.2.0" }))).status).toBe(409);
    readUpdaterMock.mockResolvedValue({
      ...IDLE,
      status: { state: "running", step: "build", updatedAt: new Date().toISOString() },
    });
    expect((await POST(post({ version: "1.2.0" }))).status).toBe(409);
    expect(requestMock).not.toHaveBeenCalled();
  });
});
