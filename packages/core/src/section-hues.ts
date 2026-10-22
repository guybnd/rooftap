// Hearth v2 (H2): section identity hues. Each section owns one hue, used in
// exactly two places: its leading tile (a tinted square with the section's
// glyph) and its screen glow. Never as text, meters, buttons or other fills:
// coral (`primary`) stays the only interactive colour and the status hues
// stay text, dots and 3px meters.
//
// Plain hex, not oklch like THEME_TOKENS: React Native takes hex as is, and
// web reads these through generated CSS variables (apps/web's
// section-hue-css.ts), so there is no second copy to keep in step.
import type { ColorScheme } from './theme-preference';

/**
 * Which swatch set a theme wears: its light/dark scheme, or `ink` for the
 * e-paper theme, where every section shares one grey tile and the glow is off.
 */
export type HueScheme = ColorScheme | 'ink';

/** The one grey swatch every section wears under the e-paper theme. */
export const INK_HUE_SWATCH: SectionHueSwatch = { tile: '#DCDCDC', glyph: '#1A1A1A', glow: '#1A1A1A' };

export type SectionHue =
  | 'coral'
  | 'lilac'
  | 'mint'
  | 'sun'
  | 'sky'
  | 'peach'
  | 'rose'
  | 'teal'
  | 'lime'
  | 'orchid'
  | 'fern'
  | 'indigo'
  | 'slate';

export interface SectionHueSwatch {
  /** Leading tile fill. */
  tile: string;
  /** Glyph drawn on the tile. */
  glyph: string;
  /** Glow colour; surfaces paint it at SECTION_GLOW_OPACITY. */
  glow: string;
}

export const SECTION_HUE_IDS: readonly SectionHue[] = [
  'coral',
  'lilac',
  'mint',
  'sun',
  'sky',
  'peach',
  'rose',
  'teal',
  'lime',
  'orchid',
  'fern',
  'indigo',
  'slate',
];

// Night tiles are a dark tint with a light glyph; day tiles flip to a pale
// tint with a deep glyph. The glow keeps one mid hue on both.
export const SECTION_HUES: Record<SectionHue, Record<ColorScheme, SectionHueSwatch>> = {
  coral: {
    dark: { tile: '#4A1F17', glyph: '#FF9A80', glow: '#FF7A5C' },
    light: { tile: '#FFE3DA', glyph: '#B23A1F', glow: '#FF7A5C' },
  },
  lilac: {
    dark: { tile: '#2E2550', glyph: '#C9B6FF', glow: '#9C8BFF' },
    light: { tile: '#EAE4FF', glyph: '#5B45C9', glow: '#9C8BFF' },
  },
  mint: {
    dark: { tile: '#123F33', glyph: '#7FF0C4', glow: '#5FE0B0' },
    light: { tile: '#DDF6EC', glyph: '#17775A', glow: '#5FE0B0' },
  },
  sun: {
    dark: { tile: '#4A3510', glyph: '#FFD84D', glow: '#FFC93D' },
    light: { tile: '#FFF1C7', glyph: '#8A6200', glow: '#FFC93D' },
  },
  sky: {
    dark: { tile: '#11304F', glyph: '#9CCBFF', glow: '#7CB8FF' },
    light: { tile: '#E1EEFF', glyph: '#2763B5', glow: '#7CB8FF' },
  },
  peach: {
    dark: { tile: '#4A2416', glyph: '#FFB59A', glow: '#FF9A73' },
    light: { tile: '#FFE6DA', glyph: '#A14B26', glow: '#FF9A73' },
  },
  rose: {
    dark: { tile: '#4A1A33', glyph: '#FFB0D4', glow: '#FF7AB8' },
    light: { tile: '#FFE1EF', glyph: '#A3326A', glow: '#FF7AB8' },
  },
  teal: {
    dark: { tile: '#0F3B3F', glyph: '#7DE3E8', glow: '#4FD3DA' },
    light: { tile: '#DBF5F6', glyph: '#16707A', glow: '#4FD3DA' },
  },
  lime: {
    dark: { tile: '#2C3A10', glyph: '#D4F27A', glow: '#B8E34F' },
    light: { tile: '#EEF8D2', glyph: '#557A0E', glow: '#B8E34F' },
  },
  orchid: {
    dark: { tile: '#3E1A4A', glyph: '#EBAAFF', glow: '#D58BFF' },
    light: { tile: '#F6E3FB', glyph: '#8A2FA6', glow: '#D58BFF' },
  },
  // Rewards: the free gap on the wheel between lime and mint.
  fern: {
    dark: { tile: '#1C3A17', glyph: '#A8EE8E', glow: '#7FDB62' },
    light: { tile: '#E2F6DA', glyph: '#2F7A1C', glow: '#7FDB62' },
  },
  indigo: {
    dark: { tile: '#1B2152', glyph: '#A9B4FF', glow: '#7083FF' },
    light: { tile: '#E4E8FF', glyph: '#3A49B8', glow: '#7083FF' },
  },
  slate: {
    dark: { tile: '#262B36', glyph: '#B9C2D4', glow: '#8A96AE' },
    light: { tile: '#E8EBF1', glyph: '#4A5468', glow: '#8A96AE' },
  },
};

/** Glow strength per scheme: louder on the dark ground, softer on paper, none on e-paper. */
export const SECTION_GLOW_OPACITY: Record<HueScheme, number> = { dark: 0.42, light: 0.3, ink: 0 };

/** Which hue each section (sections.ts id) wears. Home is the hub and wears coral. */
export const SECTION_HUE_BY_SECTION: Readonly<Record<string, SectionHue>> = {
  home: 'coral',
  household: 'lilac',
  groceries: 'mint',
  costs: 'sun',
  calendar: 'sky',
  recipes: 'peach',
  setup: 'rose',
  search: 'teal',
  checklists: 'lime',
  shopper: 'orchid',
  rewards: 'fern',
  assistant: 'indigo',
  documents: 'slate',
  profile: 'slate',
};

/** A section's hue; anything unknown wears slate, the quiet one. */
export function sectionHue(sectionId: string): SectionHue {
  return SECTION_HUE_BY_SECTION[sectionId] ?? 'slate';
}

/** A section's tile, glyph and glow colours for one colour scheme. */
export function sectionHueSwatch(sectionId: string, scheme: HueScheme): SectionHueSwatch {
  return scheme === 'ink' ? INK_HUE_SWATCH : SECTION_HUES[sectionHue(sectionId)][scheme];
}

/** One hue's swatch for a scheme (the e-paper scheme wears the shared grey). */
export function hueSwatch(hue: SectionHue, scheme: HueScheme): SectionHueSwatch {
  return scheme === 'ink' ? INK_HUE_SWATCH : SECTION_HUES[hue][scheme];
}
