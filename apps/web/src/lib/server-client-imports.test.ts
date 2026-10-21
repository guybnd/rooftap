// Next turns every export of a 'use client' module into a client reference,
// so server code that calls one throws "Attempted to call X() from the server
// but X is on the client" at runtime, which typecheck and unit tests never
// see. Shopper's price lookup hung on exactly that with householdCurrency
// (Oct 21). This fails the gate when an API route or server lib imports a
// value from a 'use client' file in @homeup/core.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(__dirname, "../../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function clientExports(): Set<string> {
  const names = new Set<string>();
  for (const file of walk(path.join(root, "packages/core/src"))) {
    const text = fs.readFileSync(file, "utf8");
    if (!/^\s*['"]use client['"]/.test(text)) continue;
    for (const m of text.matchAll(/^export (?:async )?(?:function|const|let|class) ([A-Za-z0-9_]+)/gm)) names.add(m[1]);
  }
  return names;
}

describe("server code and 'use client' core modules", () => {
  it("no API route or server lib imports a client-only value from @homeup/core", () => {
    const client = clientExports();
    const serverFiles = [
      ...walk(path.join(root, "apps/web/src/app/api")),
      ...walk(path.join(root, "apps/web/src/lib")).filter((f) => f.endsWith(".ts")),
    ];
    const bad: string[] = [];
    for (const file of serverFiles) {
      const text = fs.readFileSync(file, "utf8");
      if (/^\s*['"]use client['"]/.test(text)) continue;
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@homeup\/core["']/g)) {
        for (const raw of m[1].split(",")) {
          const name = raw.trim();
          if (!name || name.startsWith("type ")) continue;
          if (client.has(name.split(/\s+as\s+/)[0])) bad.push(`${path.relative(root, file)}: ${name}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
