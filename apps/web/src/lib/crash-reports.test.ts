import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = new Map<string, string>();
vi.mock("@/lib/admin-config", () => ({
  getAdminConfigValue: vi.fn(async (key: string) => config.get(key)),
  setAdminConfigValue: vi.fn(async (key: string, value: string) => void config.set(key, value)),
}));
vi.mock("@/lib/member-names", () => ({ memberNames: vi.fn(async () => new Map()) }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCrashReport } from "@homeup/core";
import { crashSharing, issueNumber, receiveCrash, setCrashSharing } from "./crash-reports";

type Row = Record<string, unknown>;

// Enough of supabase-js for the queries crash-reports.ts makes.
function fakeAdmin(rows: Row[]) {
  return {
    from: () => {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      let head = false;
      let max = Infinity;
      const run = () => {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (patch) for (const r of hit) Object.assign(r, patch);
        return hit.slice(0, max);
      };
      const b = {
        insert: (row: Row) => {
          const saved = { id: `c${rows.length + 1}`, created_at: new Date().toISOString(), issue_url: null, seen_count: 1, forwarded_at: null, ...row };
          rows.push(saved);
          return { select: () => ({ single: async () => ({ data: saved, error: null }) }) };
        },
        update: (p: Row) => ((patch = p), b),
        select: (_cols?: string, opts?: { head?: boolean }) => ((head = !!opts?.head), b),
        order: () => b,
        limit: (n: number) => ((max = n), b),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
        is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
        not: (k: string) => (filters.push((r) => r[k] != null), b),
        like: (k: string, pattern: string) => (filters.push((r) => new RegExp(`^${pattern.replace("%", ".*")}$`).test(String(r[k]))), b),
        gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), b),
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[] | null; count: number; error: null }) => unknown) => {
          const hit = run();
          return Promise.resolve({ data: head ? null : hit, count: hit.length, error: null }).then(resolve);
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const report = buildCrashReport(new TypeError("undefined is not a function"), { platform: "android", app: "57.6" });

beforeEach(() => config.clear());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("crash reports on the hosted server", () => {
  beforeEach(() => {
    vi.stubEnv("FEEDBACK_GITHUB_REPO", "guybnd/HomeUp");
    vi.stubEnv("FEEDBACK_GITHUB_TOKEN", "t");
  });

  it("opens one private issue per crash and counts repeats", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ html_url: "https://github.com/guybnd/HomeUp/issues/7" }), { status: 201 });
      })
    );
    const rows: Row[] = [];
    const admin = fakeAdmin(rows);
    expect(await receiveCrash(admin, report, { userId: "u1" })).toEqual({ result: "new", to: "team" });
    expect(calls[0].url).toBe("https://api.github.com/repos/guybnd/HomeUp/issues");
    expect(calls[0].body.labels).toEqual(["crash"]);
    expect(rows[0].issue_url).toBe("https://github.com/guybnd/HomeUp/issues/7");

    expect(await receiveCrash(admin, report, { userId: "u2" })).toEqual({ result: "seen", to: "team" });
    expect(rows).toHaveLength(1);
    expect(rows[0].seen_count).toBe(2);
    // 2 is a round total, so the issue's count line is edited.
    expect(calls[1].url).toBe("https://api.github.com/repos/guybnd/HomeUp/issues/7");
    expect(String(calls[1].body.body)).toContain("Seen 2 times.");
    await receiveCrash(admin, report, { userId: "u3" });
    expect(calls).toHaveLength(2);
  });

  it("labels reports from self-hosted servers", async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ html_url: "https://github.com/guybnd/HomeUp/issues/8" }), { status: 201 });
      })
    );
    const rows: Row[] = [];
    await receiveCrash(fakeAdmin(rows), report, { upstream: "1.2.0" });
    expect(calls[0].labels).toEqual(["crash", "self-hosted"]);
    expect(rows[0]).toMatchObject({ source: "crash-upstream", user_id: null, server_version: "1.2.0" });
  });

  it("stops filing new crashes for one person past the daily limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 201 })));
    const now = new Date().toISOString();
    const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, source: "crash", user_id: "u1", created_at: now, signature: `s${i}` }));
    expect(await receiveCrash(fakeAdmin(rows), report, { userId: "u1" })).toEqual({ result: "limited", to: "team" });
    expect(rows).toHaveLength(10);
  });

  it("is always shared, and the operator can't change it", async () => {
    expect(await crashSharing()).toEqual({ sharing: "hosted", fixed: true });
  });
});

describe("crash reports on a self-hosted server", () => {
  it("keeps reports with the operator until they choose to share", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const rows: Row[] = [];
    const admin = fakeAdmin(rows);
    expect(await crashSharing()).toEqual({ sharing: "ask", fixed: false });
    expect(await receiveCrash(admin, report, { userId: "u1" })).toEqual({ result: "new", to: "admin" });
    expect(fetch).not.toHaveBeenCalled();

    await setCrashSharing(admin, "share");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://homeup.vercel.app/api/feedback/crash/upstream");
    const sent = JSON.parse(String(init.body));
    expect(Object.keys(sent).sort()).toEqual(["report", "server"]);
    expect(rows[0].forwarded_at).toBeTruthy();

    const other = buildCrashReport(new RangeError("bad length"), { platform: "android" });
    expect(await receiveCrash(admin, other, { userId: "u1" })).toEqual({ result: "new", to: "team" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("follows ROOFTAP_CRASH_REPORTS over the operator's choice", async () => {
    config.set("crash_reports_sharing", "share");
    vi.stubEnv("ROOFTAP_CRASH_REPORTS", "off");
    expect(await crashSharing()).toEqual({ sharing: "off", fixed: true });
  });
});

it("reads the issue number from its URL", () => {
  expect(issueNumber("https://github.com/guybnd/HomeUp/issues/42")).toBe(42);
  expect(issueNumber("https://example.com")).toBeNull();
});
