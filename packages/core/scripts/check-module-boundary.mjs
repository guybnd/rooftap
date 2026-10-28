// Fails the lint when one module's code in packages/core/src/modules/<id>/
// imports another module's folder without a reason the registry records.
//
// A household can switch any module off (modules.ts), so a module's code may
// only lean on another module when the two are meant to work together:
//   - the importer `requires` or `enhances` the other module (its manifest), or
//   - a cross-module feature in module-features.ts names both modules.
// Shared code outside modules/ (types, the data layer, Home, search) may import
// any module: it is what puts the modules together. Every folder under
// modules/ must be a module listed in module-manifests.ts.
// Run via `npm run lint` in this package, after check-import-boundary.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which modules each module may import, read from the source text of the
 * module manifests (all of them, one after another) and module-features.ts.
 * @returns {{ ids: Set<string>, allowed: Map<string, Set<string>> }}
 */
export function moduleRules(manifestsSrc, featuresSrc) {
  const ids = new Set();
  const allowed = new Map();
  const allow = (a, b) => {
    if (!allowed.has(a)) allowed.set(a, new Set());
    allowed.get(a).add(b);
  };
  const list = (s) => [...(s ?? "").matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
  for (const block of manifestsSrc.split(/\{\s*\n\s*id: /).slice(1)) {
    const id = block.match(/^'([\w-]+)'/)?.[1];
    if (!id) continue;
    ids.add(id);
    for (const key of ["requires", "enhances"]) {
      for (const other of list(block.match(new RegExp(`\\b${key}: \\[([^\\]]*)\\]`))?.[1])) allow(id, other);
    }
  }
  for (const m of featuresSrc.matchAll(/\bmodules: \[([^\]]*)\]/g)) {
    const mods = list(m[1]);
    for (const a of mods) for (const b of mods) if (a !== b) allow(a, b);
  }
  return { ids, allowed };
}

const SPEC_RE = /(?:from\s+|import\s*\(\s*|vi\.mock\(\s*|^\s*import\s+)(['"])(\.\.?\/[^'"]+)\1/gm;

/**
 * Scan `<srcDir>/modules` for imports into another module's folder that the
 * rules don't allow, and for folders that aren't a registered module.
 * @returns {{file: string, line: number, text: string, reason: string}[]}
 */
export function scanModules(srcDir, rules) {
  const modulesDir = path.join(srcDir, "modules");
  /** @type {{file: string, line: number, text: string, reason: string}[]} */
  const violations = [];
  if (!fs.existsSync(modulesDir)) return violations;
  const moduleOf = (abs) => {
    const rel = path.relative(modulesDir, abs);
    return rel.startsWith("..") ? null : rel.split(path.sep)[0];
  };
  for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const dir = path.join(modulesDir, id);
    if (!rules.ids.has(id)) {
      violations.push({ file: dir, line: 0, text: id, reason: `"${id}" is not a module listed in module-manifests.ts` });
    }
    for (const file of walk(dir)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((text, i) => {
        for (const m of text.matchAll(SPEC_RE)) {
          const target = moduleOf(path.resolve(path.dirname(file), m[2]));
          if (!target || target === id || rules.allowed.get(id)?.has(target)) continue;
          violations.push({
            file,
            line: i + 1,
            text: text.trim(),
            reason: `module "${id}" imports module "${target}", but neither its manifest (requires/enhances) nor a module-features.ts feature links them`,
          });
        }
      });
    }
  }
  return violations;
}

/** The source of every manifest module-manifests.ts lists, one after another. */
export function readManifests(srcDir) {
  const list = fs.readFileSync(path.join(srcDir, "module-manifests.ts"), "utf8");
  return [...list.matchAll(/from '\.\/modules\/([\w-]+)\/manifest'/g)]
    .map((m) => fs.readFileSync(path.join(srcDir, "modules", m[1], "manifest.ts"), "utf8"))
    .join("\n");
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
  }
}

if (process.argv[1]?.endsWith("check-module-boundary.mjs")) {
  const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
  const rules = moduleRules(
    readManifests(SRC_DIR),
    fs.readFileSync(path.join(SRC_DIR, "module-features.ts"), "utf8"),
  );
  if (rules.ids.size === 0) {
    console.error("module-boundary check failed: no module manifests found in module-manifests.ts.");
    process.exit(1);
  }
  const violations = scanModules(SRC_DIR, rules);
  for (const v of violations) {
    console.error(`${path.relative(process.cwd(), v.file)}:${v.line}: ${v.reason} — ${v.text}`);
  }
  if (violations.length > 0) {
    console.error(`\nmodule-boundary check failed: ${violations.length} violation(s) in packages/core/src/modules.`);
    process.exit(1);
  }
  console.log("module-boundary check passed.");
}
