// The Assistant's privacy layer (tool-data.ts) and the guard that keeps every
// tool on it.
//
// Tool handlers run with the admin client, which skips row-level security.
// Before this layer each handler repeated its table's privacy rule by hand,
// and the Oct 29 audit found places where that slipped (#678 to #681). Now
// a tool reads and writes through toolData(), and this test fails:
// - a file in lib/mcp that calls .from() or .rpc() on a client itself,
// - a table with a `private` or `hidden_from` column whose rule ignores it,
// - a rule that lets a row through to the wrong person.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { fakeAdmin } from "./fake-admin";
import { canSee, toolData, TOOL_TABLES, type ToolTable, type Viewer } from "./tool-data";

const repoRoot = path.resolve(__dirname, "../../../../..");
/** The layer itself and the test stand-in may talk to the client. */
const ALLOWED = new Set(["apps/web/src/lib/mcp/tool-data.ts", "apps/web/src/lib/mcp/fake-admin.ts"]);

function toolFiles(): string[] {
  return (readdirSync(path.join(repoRoot, "apps/web/src/lib/mcp"), { recursive: true }) as string[])
    .map((f) => `apps/web/src/lib/mcp/${f.split(path.sep).join("/")}`)
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !ALLOWED.has(f));
}

/** `x.from(...)` and `x.rpc(...)` calls, but not Array.from and the like. */
function clientCalls(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(path.join(repoRoot, file), "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const target = node.expression.expression.getText(src);
      if ((name === "from" || name === "rpc") && !["Array", "Buffer", "Object"].includes(target)) {
        const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
        found.push(`${file}:${line + 1} ${target}.${name}()`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return found;
}

describe("tool files", () => {
  it("read and write household data only through tool-data.ts", () => {
    const files = toolFiles();
    expect(files.length).toBeGreaterThan(10);
    expect(files.flatMap(clientCalls)).toEqual([]);
  });
});

describe("TOOL_TABLES", () => {
  const types = readFileSync(path.join(repoRoot, "packages/core/src/database.types.ts"), "utf8").replace(/\r\n/g, "\n"); // CI checks out with CRLF on Windows.
  const rowOf = (table: string) => {
    const start = types.indexOf(`      ${table}: {\n        Row: {`);
    return start < 0 ? null : types.slice(start, types.indexOf("        }", start));
  };

  it.each(Object.keys(TOOL_TABLES) as ToolTable[])("%s has a rule that matches its columns", (table) => {
    const row = rowOf(table);
    expect(row, `${table} is not in database.types.ts`).not.toBeNull();
    const rule = TOOL_TABLES[table].rule;
    if (row!.includes("\n          private:")) expect(rule.kind).toBe("private");
    if (row!.includes("\n          hidden_from:")) expect(rule.kind).toBe("kept");
    expect(row!.includes("\n          deleted:")).toBe(!("soft" in TOOL_TABLES[table]));
  });
});

const ME = "u1";
const OTHER = "u2";
const viewer = (shared = false): Viewer => ({ userId: ME, groupId: "g1", shared });

describe("canSee", () => {
  const cases: [string, ToolTable, Record<string, unknown>, boolean, boolean][] = [
    // label, table, row, private chat, shared chat
    ["an open to-do", "household_tasks", { private: false, assigned_to: OTHER }, true, true],
    ["my private to-do", "household_tasks", { private: true, assigned_to: ME }, true, false],
    ["someone's private to-do", "household_tasks", { private: true, assigned_to: OTHER }, false, false],
    ["a private to-do with no owner", "household_tasks", { private: true, assigned_to: null }, false, false],
    ["my private event", "events", { private: true, created_by: ME }, true, false],
    ["someone's private event", "events", { private: true, created_by: OTHER }, false, false],
    ["someone's Just me card", "loyalty_cards", { private: true, created_by: OTHER }, false, false],
    ["an occasion kept from nobody", "occasions", { hidden_from: [] }, true, true],
    ["an occasion kept from me", "occasions", { hidden_from: [ME] }, false, false],
    ["a gift idea kept from someone else", "gift_ideas", { hidden_from: [OTHER] }, true, false],
    ["my cook", "cook_sessions", { user_id: ME }, true, true],
    ["someone's cook", "cook_sessions", { user_id: OTHER }, false, false],
    ["a cost line", "cost_items", { assigned_to: OTHER }, true, true],
  ];
  it.each(cases)("%s", (_label, table, row, inPrivate, inShared) => {
    expect(canSee(table, row, viewer())).toBe(inPrivate);
    expect(canSee(table, row, viewer(true))).toBe(inShared);
  });
});

describe("toolData", () => {
  const tables = () => ({
    household_tasks: [
      { id: "t1", group_id: "g1", title: "Open", private: false, assigned_to: OTHER, deleted: false },
      { id: "t2", group_id: "g1", title: "Theirs", private: true, assigned_to: OTHER, deleted: false },
      { id: "t3", group_id: "g1", title: "Mine", private: true, assigned_to: ME, deleted: false },
      { id: "t4", group_id: "g1", title: "Gone", private: false, assigned_to: ME, deleted: true },
      { id: "t5", group_id: "g2", title: "Next door", private: false, assigned_to: null, deleted: false },
    ],
    shopper_wants: [
      { id: "w1", group_id: "g1", title: "Kept from me", hidden_from: [ME], deleted: false },
      { id: "w2", group_id: "g1", title: "Kept from them", hidden_from: [OTHER], deleted: false },
    ],
  });

  it("reads this household's live rows this person may see", async () => {
    const db = toolData(fakeAdmin(tables()), viewer());
    expect((await db.rows<{ id: string }>("household_tasks")).map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(await db.row("household_tasks", "t2")).toBeNull();
    expect(await db.row("household_tasks", "t5")).toBeNull();
    expect((await db.rows<{ id: string }>("shopper_wants")).map((w) => w.id)).toEqual(["w2"]);
  });

  it("in the shared chat leaves out every private and kept row", async () => {
    const db = toolData(fakeAdmin(tables()), viewer(true));
    expect((await db.rows<{ id: string }>("household_tasks")).map((t) => t.id)).toEqual(["t1"]);
    expect(await db.rows("shopper_wants")).toEqual([]);
  });

  it("never changes a row the person can't see", async () => {
    const data = tables();
    const db = toolData(fakeAdmin(data), viewer());
    await db.update("household_tasks", ["t1", "t2", "t3", "t5"], { title: "Changed" });
    await db.remove("shopper_wants", ["w1", "w2"]);
    expect(data.household_tasks.map((t) => t.title)).toEqual(["Changed", "Theirs", "Changed", "Gone", "Next door"]);
    expect(data.shopper_wants.map((w) => w.deleted)).toEqual([false, true]);
  });

  it("puts new rows in this household", async () => {
    const data: Record<string, Record<string, unknown>[]> = {};
    const db = toolData(fakeAdmin(data), viewer());
    await db.insert("recipes", { id: "r1", group_id: "g2", title: "Soup" });
    expect(data.recipes[0].group_id).toBe("g1");
  });

  it("adds the rule's columns to a narrow select", async () => {
    const selects: string[] = [];
    const recording = {
      from: () => {
        const q = {
          select: (cols: string) => (selects.push(cols), q),
          eq: () => q,
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return q;
      },
    };
    await toolData(recording as never, viewer()).rows("household_tasks", undefined, "id");
    expect(selects).toEqual(["id, private, assigned_to"]);
  });
});
