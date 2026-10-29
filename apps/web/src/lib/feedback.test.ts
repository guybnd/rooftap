import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/member-names", () => ({ memberNames: vi.fn(async () => new Map([["u1", "Guy"]])) }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { feedbackGithub, feedbackIssueBody, feedbackIssueTitle, listFeedback, submitFeedback } from "./feedback";

type Row = Record<string, unknown>;
function fakeAdmin(rows: Row[]) {
  return {
    from: () => {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const b = {
        insert: (row: Row) => {
          const saved = { id: `f${rows.length + 1}`, created_at: "2026-10-23T03:00:00Z", issue_url: null, done_at: null, ...row };
          rows.push(saved);
          return { select: () => ({ single: async () => ({ data: saved, error: null }) }) };
        },
        update: (p: Row) => ((patch = p), b),
        select: () => b,
        order: () => b,
        limit: () => b,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (patch) for (const r of hit) Object.assign(r, patch);
          return Promise.resolve({ data: hit, error: null }).then(resolve);
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("feedback", () => {
  it("titles an issue from the first line, cut to fit", () => {
    expect(feedbackIssueTitle("Let tasks repeat\nmore detail")).toBe("Feedback: Let tasks repeat");
    expect(feedbackIssueTitle("x".repeat(100)).length).toBeLessThanOrEqual(80);
  });

  it("puts no name or household in the issue body", () => {
    const body = feedbackIssueBody("Copy text please", { version: "abc1234", id: "f1" });
    expect(body).toContain("Copy text please");
    expect(body).toContain("server abc1234");
    expect(body).not.toContain("Guy");
  });

  it("needs both a valid repo and a token to open issues", () => {
    vi.stubEnv("FEEDBACK_GITHUB_REPO", "guybnd/HomeUp");
    expect(feedbackGithub()).toBeNull();
    vi.stubEnv("FEEDBACK_GITHUB_TOKEN", "t");
    expect(feedbackGithub()).toEqual({ repo: "guybnd/HomeUp", token: "t" });
    vi.stubEnv("FEEDBACK_GITHUB_REPO", "not a repo");
    expect(feedbackGithub()).toBeNull();
  });

  it("keeps feedback without GitHub, and opens an issue with it", async () => {
    const rows: Row[] = [];
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ html_url: "https://github.com/guybnd/HomeUp/issues/9" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const plain = await submitFeedback(fakeAdmin(rows), { userId: "u1", groupId: "g1", message: "  First  " });
    expect(plain.issueUrl).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ message: "First", user_id: "u1", group_id: "g1", source: "assistant" });

    vi.stubEnv("FEEDBACK_GITHUB_REPO", "guybnd/HomeUp");
    vi.stubEnv("FEEDBACK_GITHUB_TOKEN", "t");
    const withIssue = await submitFeedback(fakeAdmin(rows), { userId: "u1", groupId: "g1", message: "Second" });
    expect(withIssue.issueUrl).toBe("https://github.com/guybnd/HomeUp/issues/9");
    expect(rows[1].issue_url).toBe("https://github.com/guybnd/HomeUp/issues/9");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/repos/guybnd/HomeUp/issues");
  });

  it("still keeps feedback when GitHub fails", async () => {
    vi.stubEnv("FEEDBACK_GITHUB_REPO", "guybnd/HomeUp");
    vi.stubEnv("FEEDBACK_GITHUB_TOKEN", "t");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const rows: Row[] = [];
    const res = await submitFeedback(fakeAdmin(rows), { userId: "u1", groupId: null, message: "Hi" });
    expect(res.issueUrl).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it("refuses empty feedback", async () => {
    await expect(submitFeedback(fakeAdmin([]), { userId: "u1", groupId: null, message: "   " })).rejects.toThrow();
  });

  it("lists the inbox with first names", async () => {
    const rows: Row[] = [{ id: "f1", user_id: "u1", group_id: "g1", message: "Hi", server_version: null, issue_url: null, done_at: null, created_at: "2026-10-23T03:00:00Z" }];
    const items = await listFeedback(fakeAdmin(rows));
    expect(items).toEqual([
      { id: "f1", message: "Hi", from: "Guy", serverVersion: null, issueUrl: null, kind: "feedback", seen: 1, done: false, createdAt: "2026-10-23T03:00:00Z" },
    ]);
  });

  it("names nobody on a crash report, and counts its repeats", async () => {
    const rows: Row[] = [
      { id: "c1", source: "crash", user_id: "u1", group_id: "g1", message: "Crash: TypeError: boom", seen_count: 4, server_version: null, issue_url: null, done_at: null, created_at: "2026-10-23T03:00:00Z" },
    ];
    const [item] = await listFeedback(fakeAdmin(rows));
    expect(item).toMatchObject({ kind: "crash", from: null, seen: 4 });
  });
});
