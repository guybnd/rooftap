import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { THEME_IDS, THEME_COLOR_KEYS, THEME_TOKENS } from "@homeup/core";

// HOUP-67: packages/core/src/theme-colors.ts mirrors this file's per-theme
// `oklch(...)` custom properties for the future RN theme (HOUP-68) — RN can't
// read CSS custom properties, so the values are duplicated as JS literals.
// This test re-parses globals.css directly and asserts every value matches,
// so the two can never silently drift apart. If this test fails after an
// intentional globals.css edit, regenerate theme-colors.ts to match.

const CSS_PATH = path.resolve(__dirname, "globals.css");
const css = fs.readFileSync(CSS_PATH, "utf8");

function extractThemeBlock(themeId: string): string {
  const escaped = themeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[data-theme="${escaped}"\\]\\s*\\{`);
  const m = re.exec(css);
  if (!m) throw new Error(`no [data-theme="${themeId}"] block found in globals.css`);
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(start, i - 1);
}

const EXTERNAL_REFS: Record<string, string> = {
  "--color-amber-600": "oklch(66.6% 0.179 58.318)",
  "--color-emerald-600": "oklch(59.6% 0.145 163.225)",
};

function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const varRe = /--([a-z0-9-]+):\s*([^;]+);/g;
  let vm: RegExpExecArray | null;
  while ((vm = varRe.exec(block))) {
    vars[vm[1]] = vm[2].trim();
  }
  return vars;
}

function resolve(vars: Record<string, string>, value: string, seen = new Set<string>()): string {
  const m = value.match(/^var\(--([a-z0-9-]+)\)$/);
  if (!m) return value;
  const ref = m[1];
  if (seen.has(ref)) throw new Error(`circular var reference: ${ref}`);
  if (`--${ref}` in EXTERNAL_REFS) return EXTERNAL_REFS[`--${ref}`];
  if (!(ref in vars)) throw new Error(`unresolved var(--${ref})`);
  seen.add(ref);
  return resolve(vars, vars[ref], seen);
}

// HOUP-295: axis-mundi-day is the `:root` default block every other theme
// block overrides (it was obsidian before the roster cut).
const rootVars = parseVars(extractThemeBlock("axis-mundi-day"));

// HOUP-132: whitespace-insensitive compare for --card-shadow — globals.css
// wraps multi-layer shadows across indented lines; theme-colors.ts's
// hand-authored `material.cardShadow` is a single-line string with the same
// tokens, so only whitespace runs need collapsing before comparing.
function normalizeShadow(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

describe("Hearth token parity (packages/core theme-colors.ts vs globals.css)", () => {
  it.each(THEME_IDS)("theme '%s' color set matches globals.css", (themeId) => {
    const vars = themeId === "axis-mundi-day" ? rootVars : { ...rootVars, ...parseVars(extractThemeBlock(themeId)) };
    for (const key of THEME_COLOR_KEYS) {
      expect(vars).toHaveProperty(key);
      const expected = resolve(vars, vars[key]);
      expect(THEME_TOKENS[themeId].colors[key]).toBe(expected);
    }
  });

  it.each(THEME_IDS)("theme '%s' radius matches globals.css", (themeId) => {
    const vars = themeId === "axis-mundi-day" ? rootVars : { ...rootVars, ...parseVars(extractThemeBlock(themeId)) };
    expect(THEME_TOKENS[themeId].radius).toBe(vars.radius);
  });

  // HOUP-132: material (card-shadow/glass/texture) drift guard, same
  // inheritance-aware merge as the color/radius checks above — a theme block
  // that doesn't redeclare a material var inherits the root's via :root.
  it.each(THEME_IDS)("theme '%s' material matches globals.css", (themeId) => {
    const vars = themeId === "axis-mundi-day" ? rootVars : { ...rootVars, ...parseVars(extractThemeBlock(themeId)) };
    const material = THEME_TOKENS[themeId].material;

    expect(normalizeShadow(resolve(vars, vars["card-shadow"]))).toBe(normalizeShadow(material.cardShadow));
    expect(resolve(vars, vars["glass-bg"])).toBe(material.glass.bg);
    expect(resolve(vars, vars["glass-border"])).toBe(material.glass.border);
    expect(resolve(vars, vars["glass-highlight"])).toBe(material.glass.highlight);
    expect(resolve(vars, vars["glass-shadow"])).toBe(material.glass.shadow);
    expect(Number(vars["texture-opacity"])).toBe(material.texture.opacity);
    expect(vars["body-texture"] ?? "none").toBe(material.texture.kind);
  });
});
