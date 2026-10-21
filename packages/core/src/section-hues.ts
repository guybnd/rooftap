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
  slate: {
    dark: { tile: '#262B36', glyph: '#B9C2D4', glow: '#8A96AE' },
    light: { tile: '#E8EBF1', glyph: '#4A5468', glow: '#8A96AE' },
  },
};

/** Glow strength per scheme: louder on the dark ground, softer on paper. */
export const SECTION_GLOW_OPACITY: Record<ColorScheme, number> = { dark: 0.42, light: 0.3 };

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
  documents: 'slate',
  profile: 'slate',
};

/** A section's hue; anything unknown wears slate, the quiet one. */
export function sectionHue(sectionId: string): SectionHue {
  return SECTION_HUE_BY_SECTION[sectionId] ?? 'slate';
}

/** A section's tile, glyph and glow colours for one colour scheme. */
export function sectionHueSwatch(sectionId: string, scheme: ColorScheme): SectionHueSwatch {
  return SECTION_HUES[sectionHue(sectionId)][scheme];
}
