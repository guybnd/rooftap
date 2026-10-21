// scripts/whats-new.mjs: the entry parser, release mapping and the PR rule CI
// runs (whats-new job), plus a validation pass over the real entries.
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// A plain path, not a file:// URL: Vite resolves it the same on Windows (the
// self-hosted CI runners) and Linux.
const script = path.join(__dirname, "../../../../scripts/whats-new.mjs");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;
beforeAll(async () => {
  mod = await import(/* @vite-ignore */ script);
});

describe("whats-new entries", () => {
  it("every entry in whats-new/ is valid", () => {
    expect(mod.loadEntries().problems).toEqual([]);
  });

  it("parses frontmatter and folds the body to one line", () => {
    expect(mod.parseEntryFile("---\ntitle: Hi there\nkind: fix\n---\nLine one\nline two.\n")).toEqual({
      meta: { title: "Hi there", kind: "fix" },
      body: "Line one line two.",
    });
    expect(mod.parseEntryFile("no frontmatter")).toBeNull();
  });

  it("maps an entry to the release it shipped in", () => {
    const releases = mod.parseReleases("## Unreleased\n\n## 1.2.0 (2026-11-01)\n\n## 1.1.0 (2026-10-21)\n");
    expect(releases).toEqual([
      { version: "1.2.0", date: "2026-11-01" },
      { version: "1.1.0", date: "2026-10-21" },
    ]);
    expect(mod.versionFor("2026-10-20", releases)).toBe("1.1.0");
    expect(mod.versionFor("2026-10-25", releases)).toBe("1.2.0");
    expect(mod.versionFor("2026-11-02", releases)).toBeNull();
  });
});

describe("the PR rule", () => {
  const app = ["apps/mobile/src/features/groceries/row.tsx"];

  it("fails app code with no entry and no note", () => {
    expect(mod.prVerdict({ changed: app, body: "", labels: [] })).toMatch(/adds no whats-new entry/);
  });

  it("passes with an entry, a No user change line or the label", () => {
    expect(mod.prVerdict({ changed: [...app, "whats-new/2026-10-21-rows.md"], body: "", labels: [] })).toBeNull();
    expect(mod.prVerdict({ changed: app, body: "Summary\n\nNo user change: refactor only", labels: [] })).toBeNull();
    expect(mod.prVerdict({ changed: app, body: "", labels: ["no-user-change"] })).toBeNull();
  });

  it("ignores tests, docs and tooling", () => {
    expect(
      mod.prVerdict({
        changed: ["packages/core/src/feed.test.ts", ".docs/x.md", "scripts/a.mjs", "apps/web/src/types.d.ts"],
        body: "",
        labels: [],
      })
    ).toBeNull();
  });

  it("doesn't count the README or an empty note", () => {
    expect(mod.prVerdict({ changed: [...app, "whats-new/README.md"], body: "No user change:", labels: [] })).not.toBeNull();
  });
});
