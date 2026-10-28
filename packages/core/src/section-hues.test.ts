import { describe, expect, it } from "vitest";
import { sections, profileSection } from "./sections";
import { GLOW_AURA, HUE_SET_IDS, HUE_SETS, INK_HUE_SWATCH, SECTION_GLOW_OPACITY, SECTION_HUE_BY_SECTION, SECTION_HUE_IDS, SECTION_HUES, customHueSwatch, hueSchemeTone, hueSwatch, isCustomHue, sectionHue, sectionHueSwatch } from "./section-hues";

const HEX = /^#[0-9A-F]{6}$/;

describe("section hues", () => {
  it("gives every registered section its own hue", () => {
    const ids = [...sections.map((s) => s.id)];
    for (const id of ids) expect(SECTION_HUE_BY_SECTION[id], id).toBeDefined();
    // Spaces show sections side by side, so no two sections share a hue. A
    // module may pick any colour (#rrggbb), just not one another section wears.
    const hues = ids.map((id) => SECTION_HUE_BY_SECTION[id]);
    expect(new Set(hues).size).toBe(hues.length);
    expect(sectionHue(profileSection.id)).toBe("slate");
  });

  it("defines a full swatch per hue and scheme", () => {
    for (const hue of SECTION_HUE_IDS) {
      for (const scheme of ["light", "dark"] as const) {
        const swatch = SECTION_HUES[hue][scheme];
        expect(swatch.tile).toMatch(HEX);
        expect(swatch.glyph).toMatch(HEX);
        expect(swatch.glow).toMatch(HEX);
      }
    }
  });

  it("falls back to slate for an unknown section", () => {
    expect(sectionHue("nope")).toBe("slate");
    expect(sectionHueSwatch("nope", "dark")).toEqual(SECTION_HUES.slate.dark);
    expect(sectionHueSwatch("groceries", "light")).toEqual(SECTION_HUES.mint.light);
  });

  it("gives every section the one grey swatch and no glow on e-paper", () => {
    expect(sectionHueSwatch("groceries", "ink")).toEqual(INK_HUE_SWATCH);
    expect(sectionHueSwatch("nope", "ink")).toEqual(INK_HUE_SWATCH);
    expect(hueSwatch("sky", "ink")).toEqual(INK_HUE_SWATCH);
    expect(hueSwatch("sky", "light")).toEqual(SECTION_HUES.sky.light);
    expect(SECTION_GLOW_OPACITY.ink).toBe(0);
  });

  it("gives each hue set a full swatch per hue, a glow and an aura", () => {
    for (const set of HUE_SET_IDS) {
      for (const hue of SECTION_HUE_IDS) {
        const swatch = HUE_SETS[set][hue];
        expect(swatch.tile, `${set} ${hue}`).toMatch(HEX);
        expect(swatch.glyph, `${set} ${hue}`).toMatch(HEX);
        expect(swatch.glow, `${set} ${hue}`).toMatch(HEX);
      }
      expect(SECTION_GLOW_OPACITY[set]).toBeGreaterThan(0);
      for (const layer of GLOW_AURA[set] ?? []) expect(layer.color).toMatch(HEX);
    }
    expect(sectionHueSwatch("groceries", "sorbet-day")).toEqual(HUE_SETS["sorbet-day"].mint);
    expect(hueSwatch("sky", "sorbet-night")).toEqual(HUE_SETS["sorbet-night"].sky);
  });

  it("works out a full swatch for any colour a module picks", () => {
    for (const scheme of ["light", "dark", ...HUE_SET_IDS] as const) {
      const swatch = customHueSwatch("#3a8f5c", scheme);
      expect(swatch.tile, scheme).toMatch(HEX);
      expect(swatch.glyph, scheme).toMatch(HEX);
      expect(swatch.glow, scheme).toMatch(HEX);
      expect(hueSwatch("#3a8f5c", scheme)).toEqual(swatch);
    }
    expect(hueSwatch("#3a8f5c", "ink")).toEqual(INK_HUE_SWATCH);
    // Light tiles stay pale and dark tiles deep, like the curated hues.
    expect(customHueSwatch("#3a8f5c", "light").tile).not.toBe(customHueSwatch("#3a8f5c", "dark").tile);
    // A grey stays grey: no hue is invented for it.
    const grey = customHueSwatch("#808080", "light").glyph;
    expect(grey.slice(1, 3)).toBe(grey.slice(3, 5));
    expect(isCustomHue("#3A8F5C")).toBe(true);
    expect(isCustomHue("mint")).toBe(false);
    expect(isCustomHue("#3a8f5")).toBe(false);
  });

  it("maps every hue scheme to its ground", () => {
    expect(hueSchemeTone("sorbet-day")).toBe("light");
    expect(hueSchemeTone("sorbet-night")).toBe("dark");
    expect(hueSchemeTone("lavender-night")).toBe("dark");
    expect(hueSchemeTone("ink")).toBe("ink");
    expect(hueSchemeTone("dark")).toBe("dark");
  });
});
