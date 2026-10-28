// New modules start right (.docs/modules.md section 15). For every module in
// core's registry this checks the shape scripts/new-module.mjs scaffolds:
//
// - its logic has a home in packages/core/src/modules/<id>/, with a hook
//   (use-*.ts) that both apps' screens bind;
// - a module with a section has a screen on web and on the phone, or a
//   recorded deferral naming its follow-up ticket;
// - rows use the shared line item (ListItem) and the shared row menu (web
//   useRowContextMenu, phone useRowMenuSheet or a long press);
// - screens hold no logic both apps need: no helper or hook declared under
//   the same name in the web and the phone screen folders, no Supabase
//   query in a screen, no OS dialog (Hearth M4), no React Native Modal;
// - a module with settings (core module-settings.ts) opens them from its
//   screen too: the More menu's last row through useModuleSettingsSheet, or
//   ModuleSettingsButton in a header with no More menu, on both platforms,
//   so its settings are never written a second time there.
//
// Modules that predate these rules have their gaps written down in
// module-conformance-baseline.ts. The baseline only shrinks: a new gap
// fails, and a gap that is gone fails until its line is removed.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODULE_SETTINGS, MODULES, sections, type ModuleId } from "@homeup/core";
import { MODULE_BASELINE, MODULES_WITHOUT_CORE, PLATFORM_DEFERRALS, type ModuleGap, type ModuleBaseline } from "./module-conformance-baseline";

const ROOT = path.join(__dirname, "../../../..");
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(tsx?)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const source = new Map<string, string>();
const text = (file: string) => {
  let s = source.get(file);
  if (s === undefined) source.set(file, (s = fs.readFileSync(file, "utf8")));
  return s;
};
const anyFile = (files: string[], re: RegExp) => files.some((f) => re.test(text(f)));
const count = (files: string[], re: RegExp) => files.reduce((n, f) => n + (text(f).match(re) ?? []).length, 0);

// Top-level helpers and hooks: `function name(` or `const name = (...) =>`.
// Components (capitalised) are left out: a web and a phone twin share a name on purpose.
const DECLARATION = /^(?:export\s+)?(?:async\s+)?function\s+([a-z]\w*)|^(?:export\s+)?const\s+([a-z]\w*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=\n]+)?=>/gm;
function declared(files: string[]): Set<string> {
  const names = new Set<string>();
  for (const f of files) for (const m of text(f).matchAll(DECLARATION)) names.add(m[1] ?? m[2]);
  return names;
}

const DATA_CALL = /\.from\(\s*["'`][a-z_]+["'`]\s*\)|\.rpc\(/g;
const OS_DIALOG = /\bAlert\.alert\(|\bwindow\.(?:confirm|prompt|alert)\(/g;
const RN_MODAL = /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*["']react-native["']/g;

interface Report {
  gaps: ModuleGap[];
  duplicated: string[];
  dataCalls: number;
  osDialogs: number;
  localModals: number;
}

function screenFiles(base: string) {
  return {
    web: [...walk(path.join(ROOT, "apps/web/src/app", base)), ...walk(path.join(ROOT, "apps/web/src/components", base))],
    mobile: [
      ...walk(path.join(ROOT, "apps/mobile/src/app/(tabs)", base)),
      ...(fs.existsSync(path.join(ROOT, "apps/mobile/src/app/(tabs)", `${base}.tsx`)) ? [path.join(ROOT, "apps/mobile/src/app/(tabs)", `${base}.tsx`)] : []),
      ...walk(path.join(ROOT, "apps/mobile/src/features", base)),
    ],
  };
}

function report(id: ModuleId): Report {
  const gaps: ModuleGap[] = [];
  const coreDir = path.join(ROOT, "packages/core/src/modules", id);
  const coreFiles = walk(coreDir);
  const hooks = new Set(coreFiles.flatMap((f) => [...text(f).matchAll(/^export function (use[A-Z]\w*)/gm)].map((m) => m[1])));
  if (!MODULES_WITHOUT_CORE[id]) {
    if (coreFiles.length === 0) gaps.push("no-core-folder");
    else if (hooks.size === 0) gaps.push("no-core-hook");
  }

  const section = sections.find((s) => s.id === id);
  if (!section) return { gaps, duplicated: [], dataCalls: 0, osDialogs: 0, localModals: 0 };

  const base = section.basePath.replace(/^\//, "");
  const { web, mobile } = screenFiles(base);
  const deferred = PLATFORM_DEFERRALS[id];
  const webRoute = fs.existsSync(path.join(ROOT, "apps/web/src/app", base, "page.tsx"));
  const mobileRoute =
    fs.existsSync(path.join(ROOT, "apps/mobile/src/app/(tabs)", base, "index.tsx")) ||
    fs.existsSync(path.join(ROOT, "apps/mobile/src/app/(tabs)", `${base}.tsx`));
  if (!webRoute && deferred?.platform !== "web") gaps.push("no-web-screen");
  if (!mobileRoute && deferred?.platform !== "mobile") gaps.push("no-mobile-screen");

  const usesHook = (files: string[]) => [...hooks].some((h) => anyFile(files, new RegExp(`\\b${h}\\(`)));
  if (hooks.size > 0) {
    if (webRoute && !usesHook(web)) gaps.push("web-skips-core-hook");
    if (mobileRoute && !usesHook(mobile)) gaps.push("mobile-skips-core-hook");
  }
  if (webRoute && !anyFile(web, /ui\/list-item["']/)) gaps.push("web-no-list-item");
  if (mobileRoute && !anyFile(mobile, /\bListItem\b[\s\S]*from ["']@homeup\/ui["']|from ["']@homeup\/ui["'][\s\S]*\bListItem\b/)) gaps.push("mobile-no-list-item");
  if (webRoute && !anyFile(web, /\buseRowContextMenu\(/)) gaps.push("web-no-row-menu");
  if (mobileRoute && !anyFile(mobile, /\buseRowMenuSheet\(|\bonLongPress=/)) gaps.push("mobile-no-row-menu");
  if (MODULE_SETTINGS[id]?.length) {
    // A detail screen can hold the door (Checklists: each list's menu), and on the phone those live outside (tabs).
    const door = /\buseModuleSettingsSheet\(|<ModuleSettingsButton\b/;
    if (webRoute && !anyFile(web, door)) gaps.push("web-no-settings-door");
    if (mobileRoute && !anyFile([...mobile, ...walk(path.join(ROOT, "apps/mobile/src/app", base))], door)) gaps.push("mobile-no-settings-door");
  }

  const mobileNames = declared(mobile);
  const duplicated = [...declared(web)].filter((n) => mobileNames.has(n)).sort();
  return {
    gaps,
    duplicated,
    dataCalls: count([...web, ...mobile], DATA_CALL),
    osDialogs: count([...web, ...mobile], OS_DIALOG),
    localModals: count(mobile, RN_MODAL),
  };
}

const HOW: Record<ModuleGap, string> = {
  "no-core-folder": "put the module's types, view helpers and hooks in packages/core/src/modules/<id>/",
  "no-core-hook": "give the core folder a use-<id>.ts hook that reads and writes the module's data",
  "no-web-screen": "add apps/web/src/app/<base>/page.tsx, or record a deferral with its follow-up ticket in PLATFORM_DEFERRALS",
  "no-mobile-screen": "add apps/mobile/src/app/(tabs)/<base>/index.tsx, or record a deferral with its follow-up ticket in PLATFORM_DEFERRALS",
  "web-skips-core-hook": "bind the module's core hook in the web screen instead of reading stores there",
  "mobile-skips-core-hook": "bind the module's core hook in the phone screen instead of reading stores there",
  "web-no-list-item": "render rows with ListItem from @/components/ui/list-item (Hearth three-slot line item)",
  "mobile-no-list-item": "render rows with ListItem from @homeup/ui (Hearth three-slot line item)",
  "web-no-row-menu": "give rows a RowMenu (core row-actions.ts) through useRowContextMenu (Hearth §13.7)",
  "mobile-no-row-menu": "open the row's RowMenu on a long press with useRowMenuSheet from @homeup/ui (Hearth §13.7)",
  "web-no-settings-door": "end the screen's More menu with useModuleSettingsSheet's row, or put ModuleSettingsButton in its header (components/module-settings-sheet.tsx), and move any setting the screen edits into the module's panels",
  "mobile-no-settings-door": "end the screen's More menu with useModuleSettingsSheet's row, or put ModuleSettingsButton in its header (features/settings/module-settings-sheet.tsx), and move any setting the screen edits into the module's panels",
};

describe("module conformance", () => {
  const ids = MODULES.map((m) => m.id);

  it("the baseline and the deferrals name real modules", () => {
    for (const id of [...Object.keys(MODULE_BASELINE), ...Object.keys(PLATFORM_DEFERRALS), ...Object.keys(MODULES_WITHOUT_CORE)]) {
      expect(ids as string[], `${id} is not a module`).toContain(id);
    }
    for (const [id, d] of Object.entries(PLATFORM_DEFERRALS)) {
      expect(d!.ticket, `${id}: a deferral names its follow-up ticket`).toMatch(/^HOUP-\d+$/);
    }
  });

  for (const id of ids) {
    it(id, () => {
      const actual = report(id);
      const known: ModuleBaseline = MODULE_BASELINE[id] ?? {};
      const problems: string[] = [];

      for (const gap of actual.gaps) {
        if (!known.gaps?.includes(gap)) problems.push(`${gap}: ${HOW[gap]}`);
      }
      for (const gap of known.gaps ?? []) {
        if (!actual.gaps.includes(gap)) problems.push(`${gap} is fixed: remove it from MODULE_BASELINE.${id}.gaps`);
      }

      const knownDup = new Set(known.duplicated ?? []);
      for (const name of actual.duplicated) {
        if (!knownDup.has(name)) {
          problems.push(`${name} is declared in both the web and the phone screens: move it to packages/core/src/modules/${id}/ and import it on both`);
        }
      }
      for (const name of knownDup) {
        if (!actual.duplicated.includes(name)) problems.push(`${name} is no longer duplicated: remove it from MODULE_BASELINE.${id}.duplicated`);
      }

      const ratchet = (key: "dataCalls" | "osDialogs" | "localModals", fix: string) => {
        const allowed = known[key] ?? 0;
        if (actual[key] > allowed) problems.push(`${key}: ${actual[key]} (allowed ${allowed}). ${fix}`);
        else if (actual[key] < allowed) problems.push(`${key} went down to ${actual[key]}: lower MODULE_BASELINE.${id}.${key}`);
      };
      ratchet("dataCalls", "Screens don't query Supabase: put the read or write in the module's core hook or an API route.");
      ratchet("osDialogs", "Ask through core's dialog store (dialog.confirm / dialog.prompt), Hearth M4.");
      ratchet("localModals", "Use Sheet or BottomSheet from @homeup/ui, not React Native's Modal.");

      expect(problems, `${id}:\n  ${problems.join("\n  ")}`).toEqual([]);
    });
  }

  it("scaffolded registries keep their new-module markers", () => {
    const markers: Record<string, string[]> = {
      "packages/core/src/module-manifests.ts": ["manifest-import", "manifest"],
      "packages/core/src/index.ts": ["module-exports", "module-hooks"],
      "packages/core/src/data/stores/index.ts": ["module-stores"],
      "packages/core/src/schema-check.ts": ["schema-check"],
      "supabase/functions/_shared/module-rules.ts": ["module-defaults"],
      "apps/web/src/lib/mcp/household-tools.ts": ["tool-import", "tool-push"],
    };
    const missing = Object.entries(markers).flatMap(([file, slots]) =>
      slots.filter((slot) => !fs.readFileSync(path.join(ROOT, file), "utf8").includes(`new-module:${slot} `)).map((slot) => `${file}: ${slot}`),
    );
    expect(missing, "scripts/new-module.mjs inserts above these markers").toEqual([]);
  });

  it("reports what it scanned", () => {
    // Guards the scan itself: if the folders move, every module would pass for the wrong reason.
    const tasks = screenFiles("tasks");
    expect(tasks.web.map(rel)).toContain("apps/web/src/app/tasks/page.tsx");
    expect(tasks.mobile.length).toBeGreaterThan(0);
  });
});
