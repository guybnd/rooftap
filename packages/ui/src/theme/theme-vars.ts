// HOUP-68: turns one @homeup/core THEME_TOKENS entry into the CSS custom
// property record the Tailwind preset's `var(--color-x)` / `var(--radius-x)`
// references resolve against (see ../../tailwind-preset.js). This is the
// runtime half of the token bridge — the preset only ever declares names.
import { deriveRadiusScale, isHueSetId, isStillTheme, THEME_TOKENS, type BodyTextureKind, type HueScheme, type ThemeId } from '@homeup/core';
import { isLightOklch, resolveBoxShadowOklch, resolveOklchToRgba, resolveOklchToRgbTriplet } from './resolve-color';

export type ThemeVars = Record<
  | `--color-${string}`
  | `--radius-${'sm' | 'md' | 'lg' | 'xl'}`
  | '--card-shadow'
  | '--glass-bg'
  | '--glass-border'
  | '--glass-highlight'
  | '--glass-shadow'
  | '--texture-opacity'
  | '--font-inscription'
  | '--font-hero',
  string
>;

// HOUP-170: mirrors web's `[data-theme="axis-mundi-night"|"axis-mundi-day"]
// .cap-inscription` gating (apps/web/src/app/globals.css) — Cinzel under the
// Axis Mundi themes, the ambient body face (matches tailwind-preset.js's
// `sans` entry) otherwise. Since HOUP-295 the roster is Axis-only, so this
// covers every shipping theme; the gate stays for any future non-Axis theme.
const AXIS_MUNDI_THEME_IDS: ReadonlySet<ThemeId> = new Set(['axis-mundi-night', 'axis-mundi-day']);

const cache = new Map<ThemeId, ThemeVars>();

/** Resolved once per theme id and cached — 30-ish oklch->hex conversions, not a per-render cost. */
export function themeVars(themeId: ThemeId): ThemeVars {
  const cached = cache.get(themeId);
  if (cached) return cached;

  const tokens = THEME_TOKENS[themeId];
  const radius = deriveRadiusScale(tokens.radius);

  const vars: Record<string, string> = {};
  for (const [key, oklch] of Object.entries(tokens.colors)) {
    vars[`--color-${key}`] = resolveOklchToRgbTriplet(oklch);
  }
  vars['--radius-sm'] = `${radius.sm}px`;
  vars['--radius-md'] = `${radius.md}px`;
  vars['--radius-lg'] = `${radius.lg}px`;
  vars['--radius-xl'] = `${radius.xl}px`;

  // HOUP-132: material tokens, alpha preserved (see resolve-color.ts) —
  // consumed via useThemeMaterial()/themeMaterial(), not through Tailwind's
  // <alpha-value> modifier.
  vars['--card-shadow'] = resolveBoxShadowOklch(tokens.material.cardShadow);
  vars['--glass-bg'] = resolveOklchToRgba(tokens.material.glass.bg);
  vars['--glass-border'] = resolveOklchToRgba(tokens.material.glass.border);
  vars['--glass-highlight'] = resolveOklchToRgba(tokens.material.glass.highlight);
  vars['--glass-shadow'] = resolveOklchToRgba(tokens.material.glass.shadow);
  vars['--texture-opacity'] = String(tokens.material.texture.opacity);
  vars['--font-inscription'] = AXIS_MUNDI_THEME_IDS.has(themeId) ? 'Cinzel_600SemiBold' : 'Geist_500Medium';
  // The Hero type step's face: Sorbet's round Fredoka, Lavender's Fraunces,
  // Bricolage elsewhere (mirrors web's `[data-theme^=...] .text-hero` rules).
  vars['--font-hero'] = themeId.startsWith('sorbet')
    ? 'Fredoka_700Bold'
    : themeId.startsWith('lavender')
      ? 'Fraunces_700Bold'
      : 'BricolageGrotesque_800ExtraBold';

  const result = vars as ThemeVars;
  cache.set(themeId, result);
  return result;
}

/** Fully-resolved, RN-ready material values for the given theme — the shape `useThemeMaterial()` exposes via context. */
export interface ResolvedThemeMaterial {
  /** Alpha-preserving, comma-`rgba(...)` box-shadow string; `"none"` passes through unchanged. */
  cardShadow: string;
  glassBg: string;
  glassBorder: string;
  glassHighlight: string;
  glassShadow: string;
  textureKind: BodyTextureKind;
  textureOpacity: number;
  /** `rgb(r, g, b)` — the theme's `--color-border`, the same hairline color web's body-texture patterns draw with. */
  textureColor: string;
  /**
   * HOUP-171: `rgba(...)` form of `--color-axis`, or `null` under any
   * non-Axis-Mundi theme — the gate `<MeridianAxis>`
   * (components/meridian-axis.tsx) renders against, mirroring
   * `--font-inscription`'s AXIS_MUNDI_THEME_IDS gating above (HOUP-170) and
   * web's `.meridian-axis { display: none }` default (globals.css).
   * Consumers must treat `null` as "render nothing."
   */
  axisColor: string | null;
  /**
   * HOUP-199: expo-status-bar `style` value for this theme — 'dark' icons on
   * this theme's light `background` (axis-mundi-day), 'light' icons on its
   * dark one (axis-mundi-night). Derived from the same `background` token
   * `ScreenBackground`'s `bg-background` paints with, so it never drifts from
   * what's actually on screen.
   */
  statusBarStyle: 'light' | 'dark';
  /**
   * `rgb(r, g, b)` form of the theme's `--color-background`, for surfaces
   * that can't take a NativeWind class: the theme root, React Navigation's
   * theme, and the Android window behind everything (expo-system-ui).
   */
  background: string;
  /**
   * Which swatch of a section hue (section-hues.ts) this theme wears: light
   * ground = 'light', dark = 'dark', the e-paper theme = 'ink' (one grey),
   * or the theme's own hue set (Sorbet). hueSchemeTone() gives its ground.
   */
  scheme: HueScheme;
  /**
   * Hearth v2: the section glow is Ember material. Axis Mundi keeps its
   * meridian as its one decorative element instead, so it gets no glow;
   * neither does the flat e-paper theme.
   */
  sectionGlow: boolean;
  /**
   * The e-paper theme (core isStillTheme): every animation is instant and
   * the tab glide is off, as under the device's reduced-motion setting.
   * Read it through useStillMotion(), which ORs the two.
   */
  still: boolean;
}

/** Resolved once per theme id, reusing themeVars' cache — not a per-render cost. */
export function themeMaterial(themeId: ThemeId): ResolvedThemeMaterial {
  const vars = themeVars(themeId);
  const { texture } = THEME_TOKENS[themeId].material;
  return {
    cardShadow: vars['--card-shadow'],
    glassBg: vars['--glass-bg'],
    glassBorder: vars['--glass-border'],
    glassHighlight: vars['--glass-highlight'],
    glassShadow: vars['--glass-shadow'],
    textureKind: texture.kind,
    textureOpacity: texture.opacity,
    textureColor: `rgb(${vars['--color-border'].split(' ').join(', ')})`,
    axisColor: AXIS_MUNDI_THEME_IDS.has(themeId) ? resolveOklchToRgba(THEME_TOKENS[themeId].colors.axis) : null,
    statusBarStyle: isLightOklch(THEME_TOKENS[themeId].colors.background) ? 'dark' : 'light',
    background: `rgb(${vars['--color-background'].split(' ').join(', ')})`,
    scheme: isStillTheme(themeId) ? 'ink' : isHueSetId(themeId) ? themeId : isLightOklch(THEME_TOKENS[themeId].colors.background) ? 'light' : 'dark',
    sectionGlow: !AXIS_MUNDI_THEME_IDS.has(themeId) && !isStillTheme(themeId),
    still: isStillTheme(themeId),
  };
}
