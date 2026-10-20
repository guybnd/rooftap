// Every schema minimum in core's server-features.ts and modules.ts must name a
// migration that exists, or a typo would hide the feature on every server
// (or on none). Lives in apps/web because core can't use Node's fs.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES, SCHEMA_BASELINE, SERVER_FEATURES } from "@homeup/core";

const migrations = new Set(
  fs
    .readdirSync(path.join(__dirname, "../../../../supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -".sql".length))
);

describe("server feature minimums", () => {
  it("names a real migration as the baseline", () => {
    expect(migrations.has(SCHEMA_BASELINE)).toBe(true);
  });

  it.each(Object.entries(SERVER_FEATURES))("%s needs a real migration", (_id, f) => {
    expect(migrations.has(f.minSchema)).toBe(true);
  });

  it("names real migrations for modules with a minimum", () => {
    for (const m of MODULES) if (m.minSchema) expect(migrations.has(m.minSchema)).toBe(true);
  });
});
