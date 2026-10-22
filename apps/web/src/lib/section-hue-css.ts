// Hearth v2: the section identity hues (packages/core section-hues.ts) as CSS
// custom properties. The root layout inlines this once, so `data-hue` on any
// element resolves `--hue-tile` / `--hue-glyph` / `--hue-glow` for the
// active scheme (`.dark` on <html> picks the night swatch, the e-paper
// theme one grey) with no second
// copy of the values to keep in step, and no flash before hydration.
import { INK_HUE_SWATCH, SECTION_GLOW_OPACITY, SECTION_HUE_IDS, SECTION_HUES, STILL_THEME_IDS, type SectionHueSwatch } from "@homeup/core";

function declarations(swatch: SectionHueSwatch): string {
  return `--hue-tile:${swatch.tile};--hue-glyph:${swatch.glyph};--hue-glow:${swatch.glow}`;
}

export function sectionHueCss(): string {
  const rules = [`:root{--glow-opacity:${SECTION_GLOW_OPACITY.light}}`, `.dark{--glow-opacity:${SECTION_GLOW_OPACITY.dark}}`];
  for (const hue of SECTION_HUE_IDS) {
    rules.push(`[data-hue="${hue}"]{${declarations(SECTION_HUES[hue].light)}}`);
    rules.push(`.dark [data-hue="${hue}"]{${declarations(SECTION_HUES[hue].dark)}}`);
  }
  // The e-paper theme: every section wears the one grey tile and no glow.
  for (const theme of STILL_THEME_IDS) {
    rules.push(`[data-theme="${theme}"]{--glow-opacity:${SECTION_GLOW_OPACITY.ink}}`);
    rules.push(`[data-theme="${theme}"] [data-hue],[data-theme="${theme}"][data-hue]{${declarations(INK_HUE_SWATCH)}}`);
  }
  return rules.join("");
}
