// Since 2026-10-30 Supabase no longer grants anon/authenticated/service_role on
// new public tables, including when migrations replay onto a fresh project, so
// a table without an explicit grant answers "permission denied" through the
// Data API. Every migration after the backfill must grant each public table it
// creates (CLAUDE.md migration rule 6). Lives in apps/web because core can't
// use Node's fs.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.join(__dirname, "../../../../supabase/migrations");

// Tables created up to and including this migration are granted by it.
const BACKFILL = "20261021044500_data_api_grants";

const stripComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

// `create table [if not exists] [public.]name`, skipping other schemas.
const CREATE_TABLE = /\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*(\.)?/gi;

function ungrantedTables(sql: string): string[] {
  const body = stripComments(sql);
  const missing: string[] = [];
  for (const m of body.matchAll(CREATE_TABLE)) {
    if (m[2]) continue; // schema-qualified with something other than public
    const table = m[1].toLowerCase();
    const grant = new RegExp(
      `\\bgrant\\s[^;]*\\bon\\s+(?:table\\s+)?(?:"?public"?\\.)?"?${table}"?\\s*(?:,|\\bto\\b)[^;]*;`,
      "i"
    );
    if (!grant.test(body)) missing.push(table);
  }
  return missing;
}

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("migration grants", () => {
  it("has the backfill migration", () => {
    expect(files).toContain(`${BACKFILL}.sql`);
  });

  it.each(files.filter((f) => f.slice(0, -".sql".length) > BACKFILL))(
    "%s grants every public table it creates",
    (file) => {
      expect(ungrantedTables(fs.readFileSync(path.join(dir, file), "utf8"))).toEqual([]);
    }
  );

  it("flags an ungranted table and accepts a granted one", () => {
    expect(ungrantedTables("create table if not exists public.foo (id uuid);")).toEqual(["foo"]);
    expect(ungrantedTables("create table foo (id uuid);\n-- grant select on foo to anon;")).toEqual(["foo"]);
    expect(
      ungrantedTables(
        "create table foo (id uuid);\ngrant select, insert on public.foo to anon, authenticated;"
      )
    ).toEqual([]);
    expect(ungrantedTables("create table private.bar (id uuid);")).toEqual([]);
    expect(
      ungrantedTables("create table foo (id uuid);\ngrant select on public.foo_bar to anon;")
    ).toEqual(["foo"]);
  });
});
