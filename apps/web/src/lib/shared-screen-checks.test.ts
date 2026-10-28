// Shared screens loop over module slots (.docs/modules.md, section 17). The
// calendar, Home, capture, search, share and the Android widget belong to no
// module, so they never ask whether one module is on or hidden by its id:
// `isEnabled("bins")`, `hidden.includes("costs")`, `isHidden("setup")`. A
// module puts its content there through a slot, and a cross-module feature
// is checked with `useModules().feature(...)`.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULE_IDS } from "@homeup/core";

const ROOT = path.join(__dirname, "../../../..");

/** The folders and files of the screens no module owns. */
const SHARED_SCREENS = [
  "apps/web/src/app/calendar",
  "apps/web/src/app/home",
  "apps/web/src/app/share-target",
  "apps/web/src/components/capture",
  "apps/mobile/src/app/(tabs)/calendar",
  "apps/mobile/src/app/(tabs)/home",
  "apps/mobile/src/features/calendar",
  "apps/mobile/src/features/home",
  "apps/mobile/src/components/capture",
  "apps/mobile/src/components/search",
  "apps/mobile/src/components/nav",
  "apps/mobile/src/widgets",
  "apps/mobile/src/lib/share-intent-routing.ts",
];

function walk(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return [p];
  return fs.readdirSync(p, { withFileTypes: true }).flatMap((e) => {
    const child = path.join(p, e.name);
    if (e.isDirectory()) return walk(child);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [child] : [];
  });
}

const ids = ALL_MODULE_IDS.map((id) => id.replace(/[-]/g, "\\-")).join("|");
// A call that takes one module id as a literal: isEnabled, isModuleEnabled, isHidden, .includes, .has.
const MODULE_CHECK = new RegExp(`\\b(?:isEnabled|isModuleEnabled|isHidden|includes|has)\\(\\s*(?:[\\w.]+,\\s*)?["'\`](?:${ids})["'\`]\\s*\\)`, "g");

function checksByFile(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of SHARED_SCREENS) {
    for (const file of walk(path.join(ROOT, entry))) {
      const n = (fs.readFileSync(file, "utf8").match(MODULE_CHECK) ?? []).length;
      if (n) out[path.relative(ROOT, file).split(path.sep).join("/")] = n;
    }
  }
  return out;
}

describe("shared screens", () => {
  const found = checksByFile();

  it("list folders and files that exist", () => {
    for (const entry of SHARED_SCREENS) expect(fs.existsSync(path.join(ROOT, entry)), entry).toBe(true);
  });

  it("check no module by its id (use a slot or a module feature)", () => {
    expect(found, "a shared screen checks a module by its id: add a slot source or a module feature instead").toEqual({});
  });
});
