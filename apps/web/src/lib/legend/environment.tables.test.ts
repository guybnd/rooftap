// The web's IndexedDB persist plugin opens one database with a fixed list of
// object stores (INDEXEDDB_TABLES in environment.ts). A synced store whose
// storageName is missing from that list throws "One of the specified object
// stores was not found" on every page and never reports loaded, so a screen
// that waits for it shows "Loading…" forever. Shopper and cook sessions
// shipped like that (found Oct 28). This fails the gate when a store in core
// persists to a table the web never declared.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(__dirname, "../../../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function storageNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const dir of ["packages/core/src", "apps/web/src"]) {
    for (const file of walk(path.join(root, dir))) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/storageName:\s*['"]([a-z0-9_]+)['"]/g)) {
        names.set(m[1], path.relative(root, file));
      }
    }
  }
  return names;
}

function declaredTables(): Set<string> {
  const text = fs.readFileSync(path.join(__dirname, "environment.ts"), "utf8");
  const block = /const INDEXEDDB_TABLES = \[([\s\S]*?)\];/.exec(text);
  if (!block) throw new Error("INDEXEDDB_TABLES not found in environment.ts");
  return new Set([...block[1].matchAll(/['"]([a-z0-9_]+)['"]/g)].map((m) => m[1]));
}

describe("web IndexedDB tables", () => {
  it("declares a table for every synced store's storageName", () => {
    const names = storageNames();
    expect(names.size).toBeGreaterThan(20);
    const declared = declaredTables();
    const missing = [...names].filter(([name]) => !declared.has(name)).map(([name, file]) => `${name} (${file})`);
    expect(missing, "add these to INDEXEDDB_TABLES and bump INDEXEDDB_VERSION").toEqual([]);
  });
});
