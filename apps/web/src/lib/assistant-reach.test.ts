// Every module and every table says how the Assistant reaches it (core
// assistant-reach.ts): a new feature can't land without someone deciding
// whether the Assistant should see it. Lives in apps/web because core can't
// use Node's fs to read the migrations.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_TOOLS, MODULES, MODULES_WITHOUT_TOOLS, SEND_FEEDBACK_TOOL, TABLE_REACH } from "@homeup/core";

const dir = path.join(__dirname, "../../../../supabase/migrations");

// Line comments first: a path like /api/calendar/* inside one would otherwise open a block comment.
const stripComments = (sql: string) => sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const NAME = String.raw`(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`;
const CREATE = new RegExp(String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${NAME}\s*(\.)?`, "gi");
const DROP = new RegExp(String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?${NAME}`, "gi");
const RENAME = new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?${NAME}\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)"?`, "gi");

/** The public tables the migrations leave behind, in file order: created, renamed, dropped. */
function liveTables(files: string[]): Set<string> {
  const tables = new Set<string>();
  for (const sql of files.map(stripComments)) {
    const steps: { at: number; run: () => void }[] = [];
    for (const m of sql.matchAll(CREATE)) if (!m[2]) steps.push({ at: m.index!, run: () => tables.add(m[1].toLowerCase()) });
    for (const m of sql.matchAll(DROP)) steps.push({ at: m.index!, run: () => tables.delete(m[1].toLowerCase()) });
    for (const m of sql.matchAll(RENAME))
      steps.push({
        at: m.index!,
        run: () => {
          if (tables.delete(m[1].toLowerCase())) tables.add(m[2].toLowerCase());
        },
      });
    for (const step of steps.sort((a, b) => a.at - b.at)) step.run();
  }
  return tables;
}

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));

const toolNames = new Set([...MCP_TOOLS.map((t) => t.name), SEND_FEEDBACK_TOOL]);

describe("assistant reach", () => {
  it("covers every table the migrations create", () => {
    const missing = [...liveTables(files)].filter((t) => !(t in TABLE_REACH)).sort();
    expect(missing, "Add each table to TABLE_REACH in packages/core/src/assistant-reach.ts: its tools, or why it has none").toEqual([]);
  });

  it("lists no table the migrations don't have", () => {
    const live = liveTables(files);
    expect(Object.keys(TABLE_REACH).filter((t) => !live.has(t))).toEqual([]);
  });

  it("names only real tools, and gives a reason for every table without one", () => {
    for (const [table, reach] of Object.entries(TABLE_REACH)) {
      if ("tools" in reach) {
        expect(reach.tools.length, table).toBeGreaterThan(0);
        expect(reach.tools.filter((t) => !toolNames.has(t)), table).toEqual([]);
      } else {
        expect(reach.none.trim().length, table).toBeGreaterThan(10);
      }
    }
  });

  it("gives every module a tool, or a reason it has none", () => {
    const withTools = new Set(MCP_TOOLS.map((t) => t.module));
    const missing = MODULES.filter((m) => !withTools.has(m.id) && !MODULES_WITHOUT_TOOLS[m.id]).map((m) => m.id);
    expect(missing, "Add household tools for the module (core mcp-tools.ts), or a reason to MODULES_WITHOUT_TOOLS").toEqual([]);
  });

  it("drops a module's reason once it has tools", () => {
    const withTools = new Set(MCP_TOOLS.map((t) => t.module));
    expect(Object.keys(MODULES_WITHOUT_TOOLS).filter((id) => withTools.has(id as never))).toEqual([]);
  });

  it("follows renames and drops", () => {
    const live = liveTables([
      "create table if not exists public.a (id uuid);\ncreate table b (id uuid);",
      "alter table a rename to c;\n-- create table d (id uuid);\ndrop table if exists b cascade;\ncreate table other.e (id uuid);",
    ]);
    expect([...live].sort()).toEqual(["c"]);
  });
});
