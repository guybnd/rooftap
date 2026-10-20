// Hearth v2: the section identity hues (packages/core section-hues.ts) as CSS
// custom properties. The root layout inlines this once, so `data-hue` on any
// element resolves `--hue-tile` / `--hue-glyph` / `--hue-glow` for the
// active scheme (`.dark` on <html> picks the night swatch) with no second
// copy of the values to keep in step, and no flash before hydration.
import { SECTION_GLOW_OPACITY, SECTION_HUE_IDS, SECTION_HUES, type SectionHueSwatch } from "@homeup/core";

function declarations(swatch: SectionHueSwatch): string {
  return `--hue-tile:${swatch.tile};--hue-glyph:${swatch.glyph};--hue-glow:${swatch.glow}`;
}

export function sectionHueCss(): string {
  const rules = [`:root{--glow-opacity:${SECTION_GLOW_OPACITY.light}}`, `.dark{--glow-opacity:${SECTION_GLOW_OPACITY.dark}}`];
  for (const hue of SECTION_HUE_IDS) {
    rules.push(`[data-hue="${hue}"]{${declarations(SECTION_HUES[hue].light)}}`);
    rules.push(`.dark [data-hue="${hue}"]{${declarations(SECTION_HUES[hue].dark)}}`);
  }
  return rules.join("");
}
