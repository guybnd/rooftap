import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { moduleRules, readManifests, scanModules } from "./check-module-boundary.mjs";

// The module-boundary lint, against throwaway fixture dirs and a small
// set of manifests, plus one run against the real packages/core/src.

const MANIFESTS_SRC = `
export const groceriesModule = defineModule({
  id: 'groceries',
  label: 'Groceries',
  enhances: ['recipes'],
  section: { navItems: [{ href: '/groceries', label: 'Shopping List' }] },
});
export const recipesModule = defineModule({
  id: 'recipes',
  label: 'Recipes',
});
export const costsModule = defineModule({
  id: 'costs',
  label: 'Costs',
});
export const googleCalendarModule = defineModule({
  id: 'google-calendar',
  requires: ['calendar'],
});
export const calendarModule = defineModule({
  id: 'calendar',
});
`;
const FEATURES_SRC = `
  'costs.groceries': {
    modules: ['costs', 'groceries'],
  },
`;

let tmpDir: string | undefined;

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

function fixture(files: Record<string, string>): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-module-boundary-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(tmpDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, rel), body);
  }
  return tmpDir;
}

describe("moduleRules", () => {
  it("reads ids, requires/enhances and the features' module pairs", () => {
    const r = moduleRules(MANIFESTS_SRC, FEATURES_SRC);
    expect([...r.ids]).toEqual(["groceries", "recipes", "costs", "google-calendar", "calendar"]);
    expect([...(r.allowed.get("groceries") ?? [])].sort()).toEqual(["costs", "recipes"]);
    expect([...(r.allowed.get("costs") ?? [])]).toEqual(["groceries"]);
    expect([...(r.allowed.get("google-calendar") ?? [])]).toEqual(["calendar"]);
    expect(r.allowed.get("recipes")).toBeUndefined();
  });
});

describe("scanModules", () => {
  const rules = moduleRules(MANIFESTS_SRC, FEATURES_SRC);

  it("passes own-folder, shared and allowed imports", () => {
    const dir = fixture({
      "types.ts": "export type X = 1;\n",
      "modules/recipes/recipes.ts": "export const r = 1;\n",
      "modules/groceries/a.ts": "export const a = 1;\n",
      "modules/groceries/b.ts": `import { a } from './a';\nimport type { X } from '../../types';\nimport { r } from '../recipes/recipes';\n`,
    });
    expect(scanModules(dir, rules)).toEqual([]);
  });

  it("flags an import into a module with no recorded link", () => {
    const dir = fixture({
      "modules/groceries/a.ts": "export const a = 1;\n",
      "modules/recipes/r.ts": `import { a } from '../groceries/a';\n`,
    });
    const v = scanModules(dir, rules);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
    expect(v[0].reason).toMatch(/module "recipes" imports module "groceries"/);
  });

  it("flags a vi.mock and a dynamic import too", () => {
    const dir = fixture({
      "modules/groceries/a.ts": "export const a = 1;\n",
      "modules/recipes/r.test.ts": `vi.mock('../groceries/a');\nconst m = await import('../groceries/a');\n`,
    });
    expect(scanModules(dir, rules)).toHaveLength(2);
  });

  it("flags a folder that is not a registered module", () => {
    const dir = fixture({ "modules/widgets/w.ts": "export const w = 1;\n" });
    expect(scanModules(dir, rules).map((v) => v.reason)).toEqual(['"widgets" is not a module listed in module-manifests.ts']);
  });

  it("passes on the real packages/core/src", () => {
    const src = path.resolve(__dirname, "..", "src");
    const real = moduleRules(
      readManifests(src),
      fs.readFileSync(path.join(src, "module-features.ts"), "utf8"),
    );
    expect(real.ids.size).toBeGreaterThan(10);
    expect(scanModules(src, real)).toEqual([]);
  });
});
