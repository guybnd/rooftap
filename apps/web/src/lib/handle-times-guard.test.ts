// handle_times() runs before every write to the 49 synced tables. Since
// 20261108170000_stale_update_keeps_delete.sql it also keeps a row deleted when
// a stale offline edit tries to bring it back. A later migration that
// redefines the function must keep that guard, or deleted rows start coming
// back again. Lives in apps/web because core can't use Node's fs.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.join(__dirname, "../../../../supabase/migrations");
const DEFINES = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?handle_times\s*\(/i;

describe("handle_times()", () => {
  it("keeps the keep-deleted guard in its latest definition", () => {
    const latest = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => DEFINES.test(fs.readFileSync(path.join(dir, f), "utf8")))
      .pop();
    expect(latest).toBeDefined();
    const sql = fs.readFileSync(path.join(dir, latest!), "utf8");
    expect(sql, `${latest} redefines handle_times() without the keep-deleted guard`).toMatch(/keep-deleted guard/);
  });
});
