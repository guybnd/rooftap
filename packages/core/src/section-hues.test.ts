import { describe, expect, it } from "vitest";
import { sections, profileSection } from "./sections";
import { SECTION_HUE_BY_SECTION, SECTION_HUE_IDS, SECTION_HUES, sectionHue, sectionHueSwatch } from "./section-hues";

const HEX = /^#[0-9A-F]{6}$/;

describe("section hues", () => {
  it("gives every registered section its own hue", () => {
    const ids = [...sections.map((s) => s.id)];
    for (const id of ids) expect(SECTION_HUE_BY_SECTION[id], id).toBeDefined();
    // Spaces show sections side by side, so no two sections share a hue.
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
});
