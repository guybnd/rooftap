// Hearth v2: the section identity hues (packages/core section-hues.ts) as CSS
// custom properties. The root layout inlines this once, so `data-hue` on any
// element resolves `--hue-tile` / `--hue-glyph` / `--hue-glow` for the
// active scheme (`.dark` on <html> picks the night swatch, the e-paper
// theme one grey, Sorbet its own set) with no second
// copy of the values to keep in step, and no flash before hydration.
import {
  GLOW_AURA,
  HUE_SET_IDS,
  INK_HUE_SWATCH,
  SECTION_GLOW_OPACITY,
  SECTION_HUE_IDS,
  customSectionHues,
  hueSwatch,
  STILL_THEME_IDS,
  type GlowAuraLayer,
  type SectionHueSwatch,
} from "@homeup/core";

function declarations(swatch: SectionHueSwatch): string {
  return `--hue-tile:${swatch.tile};--hue-glyph:${swatch.glyph};--hue-glow:${swatch.glow}`;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function auraLayer(layer: GlowAuraLayer): string {
  return `radial-gradient(ellipse ${pct(layer.rx)} ${pct(layer.ry)} at ${pct(layer.cx)} ${pct(layer.cy)},${layer.color} 0%,transparent ${pct(layer.fade)})`;
}

// The section's own wash (globals.css .section-glow), phone and wide shapes.
const WASH = "radial-gradient(ellipse 85% 78% at var(--glow-x) -8%,var(--glow-hue) 0%,color-mix(in srgb,var(--glow-hue) 35%,transparent) 55%,transparent 100%)";
const WASH_WIDE = "radial-gradient(ellipse 55% 85% at var(--glow-x) -10%,var(--glow-hue) 0%,color-mix(in srgb,var(--glow-hue) 35%,transparent) 55%,transparent 100%)";

export function sectionHueCss(): string {
  const rules = [`:root{--glow-opacity:${SECTION_GLOW_OPACITY.light}}`, `.dark{--glow-opacity:${SECTION_GLOW_OPACITY.dark}}`];
  // The curated hues, then any colour a module manifest picks.
  const hues = [...SECTION_HUE_IDS, ...customSectionHues()];
  for (const hue of hues) {
    rules.push(`[data-hue="${hue}"]{${declarations(hueSwatch(hue, "light"))}}`);
    rules.push(`.dark [data-hue="${hue}"]{${declarations(hueSwatch(hue, "dark"))}}`);
  }
  // The e-paper theme: every section wears the one grey tile and no glow.
  for (const theme of STILL_THEME_IDS) {
    rules.push(`[data-theme="${theme}"]{--glow-opacity:${SECTION_GLOW_OPACITY.ink}}`);
    rules.push(`[data-theme="${theme}"] [data-hue],[data-theme="${theme}"][data-hue]{${declarations(INK_HUE_SWATCH)}}`);
  }
  // Themes with their own hue set (Sorbet): their swatches, glow strength and
  // the fixed aura painted under the section's wash.
  for (const theme of HUE_SET_IDS) {
    rules.push(`[data-theme="${theme}"]{--glow-opacity:${SECTION_GLOW_OPACITY[theme]}}`);
    for (const hue of hues) {
      rules.push(`[data-theme="${theme}"] [data-hue="${hue}"],[data-theme="${theme}"][data-hue="${hue}"]{${declarations(hueSwatch(hue, theme))}}`);
    }
    const aura = GLOW_AURA[theme];
    if (aura?.length) {
      const layers = aura.map(auraLayer).join(",");
      rules.push(`[data-theme="${theme}"] .section-glow{background:${WASH},${layers}}`);
      rules.push(`@media (min-width:768px){[data-theme="${theme}"] .section-glow{background:${WASH_WIDE},${layers}}}`);
    }
  }
  return rules.join("");
}
