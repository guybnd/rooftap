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
 * A theme with its own section hue set instead of the Hearth light/dark
 * swatches (HUE_SETS). Named after the theme that wears it.
 */
export type HueSetId = 'sorbet-day' | 'sorbet-night' | 'lavender-day' | 'lavender-night';

export const HUE_SET_IDS: readonly HueSetId[] = ['sorbet-day', 'sorbet-night', 'lavender-day', 'lavender-night'];

/**
 * Which swatch set a theme wears: its light/dark scheme, `ink` for the
 * e-paper theme, where every section shares one grey tile and the glow is
 * off, or a theme's own hue set.
 */
export type HueScheme = ColorScheme | 'ink' | HueSetId;

export function isHueSetId(value: unknown): value is HueSetId {
  return typeof value === 'string' && (HUE_SET_IDS as readonly string[]).includes(value);
}

/** The ground a hue scheme sits on: light, dark, or the e-paper greys. */
export function hueSchemeTone(scheme: HueScheme): ColorScheme | 'ink' {
  if (isHueSetId(scheme)) return scheme.endsWith('-night') ? 'dark' : 'light';
  return scheme;
}

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

// Themes with their own hue set. Sorbet: the same thirteen hues pushed to gummy-sweet chroma. Day tiles are
// candy pastels with a saturated glyph; night tiles glow like jelly.
export const HUE_SETS: Record<HueSetId, Record<SectionHue, SectionHueSwatch>> = {
  'sorbet-day': {
    coral: { tile: '#FFC7B6', glyph: '#CD2900', glow: '#FF8F70' },
    lilac: { tile: '#DFD3FF', glyph: '#794FDB', glow: '#C8AAFF' },
    mint: { tile: '#A0F3CE', glyph: '#008C4E', glow: '#00E9A5' },
    sun: { tile: '#F8DB94', glyph: '#9A5E00', glow: '#F7BA00' },
    sky: { tile: '#A8E5FF', glyph: '#0070D4', glow: '#38CDFF' },
    peach: { tile: '#FFCDA4', glyph: '#C63C00', glow: '#FF9B39' },
    rose: { tile: '#FFC4E5', glyph: '#C2267E', glow: '#FF8AD1' },
    teal: { tile: '#8DF1F7', glyph: '#00808F', glow: '#00E6F4' },
    lime: { tile: '#CFEAA4', glyph: '#507800', glow: '#A8D834' },
    orchid: { tile: '#FBCAFF', glyph: '#A33BB9', glow: '#F998FF' },
    fern: { tile: '#BAEFB4', glyph: '#008000', glow: '#74E269' },
    indigo: { tile: '#C8DBFF', glyph: '#4D5FE5', glow: '#9BB9FF' },
    slate: { tile: '#D4DFEE', glyph: '#5E738F', glow: '#B0C6E3' },
  },
  'sorbet-night': {
    coral: { tile: '#752110', glyph: '#FFAD90', glow: '#FF6F4D' },
    lilac: { tile: '#46327C', glyph: '#DAC2FF', glow: '#B790FF' },
    mint: { tile: '#005531', glyph: '#50F9BD', glow: '#00D98E' },
    sun: { tile: '#5D3B00', glyph: '#FFD03F', glow: '#E9A400' },
    sky: { tile: '#00457D', glyph: '#70E1FF', glow: '#00B9FF' },
    peach: { tile: '#712900', glyph: '#FFB66B', glow: '#FF7E00' },
    rose: { tile: '#6F1F49', glyph: '#FFA8E3', glow: '#FF6BBF' },
    teal: { tile: '#00535B', glyph: '#00F6FF', glow: '#00D6E7' },
    lime: { tile: '#344C00', glyph: '#BFEA6A', glow: '#92C600' },
    orchid: { tile: '#5D2769', glyph: '#FFB3FF', glow: '#EB7BFF' },
    fern: { tile: '#0D5107', glyph: '#96F28C', glow: '#4DD141' },
    indigo: { tile: '#2D3A82', glyph: '#B3CFFF', glow: '#84A1FF' },
    slate: { tile: '#384352', glyph: '#C6D9F3', glow: '#9AB3D4' },
  },
  // Lavender: the hues softened a touch, Home moved from coral to orchid so
  // the hub glow stays in the violet family.
  'lavender-day': {
    coral: { tile: '#F5DEFF', glyph: '#8851A0', glow: '#E2ABFB' },
    lilac: { tile: '#E8E2FF', glyph: '#6F5AB1', glow: '#C6B5FF' },
    mint: { tile: '#C9F4DF', glyph: '#007A52', glow: '#6DDDB0' },
    sun: { tile: '#F6E7C1', glyph: '#8C6500', glow: '#E5BF5F' },
    sky: { tile: '#CCECFF', glyph: '#0171B3', glow: '#7CCCFF' },
    peach: { tile: '#FFDFC9', glyph: '#A65108', glow: '#FFAD77' },
    rose: { tile: '#FFDAEB', glyph: '#A34674', glow: '#FFA2CC' },
    teal: { tile: '#C0F3F6', glyph: '#00818A', glow: '#46DCE3' },
    lime: { tile: '#E0EFC9', glyph: '#5A7801', glow: '#B2D277' },
    orchid: { tile: '#F8DDFE', glyph: '#8D4F9B', glow: '#E8AAF6' },
    fern: { tile: '#D5F1D1', glyph: '#377E31', glow: '#95D88E' },
    indigo: { tile: '#DBE7FF', glyph: '#5264B8', glow: '#A8BFFF' },
    slate: { tile: '#E2E8F1', glyph: '#5F6D7F', glow: '#B7C6D8' },
  },
  'lavender-night': {
    coral: { tile: '#4C3058', glyph: '#EFC5FF', glow: '#CC8EE8' },
    lilac: { tile: '#3E3561', glyph: '#D8CDFF', glow: '#AD99FC' },
    mint: { tile: '#004933', glyph: '#9AECC8', glow: '#33C694' },
    sun: { tile: '#4E3A00', glyph: '#F2D48E', glow: '#D0A424' },
    sky: { tile: '#134062', glyph: '#A2DFFF', glow: '#52B3FE' },
    peach: { tile: '#5C3012', glyph: '#FFC69D', glow: '#F08F4F' },
    rose: { tile: '#5B2B41', glyph: '#FFBEDE', glow: '#EE83B4' },
    teal: { tile: '#00484D', glyph: '#86EBF0', glow: '#00C5CE' },
    lime: { tile: '#344411', glyph: '#C9E39E', glow: '#96BA4E' },
    orchid: { tile: '#4E2F56', glyph: '#F4C4FF', glow: '#D28CE2' },
    fern: { tile: '#244720', glyph: '#B4E8AE', glow: '#73C16B' },
    indigo: { tile: '#2F3A65', glyph: '#C1D4FF', glow: '#8CA4FF' },
    slate: { tile: '#373E47', glyph: '#CDD9E8', glow: '#9CACC2' },
  },
};

/**
 * Glow strength per scheme: louder on the dark ground, softer on paper, none
 * on e-paper. Sorbet runs louder because its glow carries the aura too.
 */
export const SECTION_GLOW_OPACITY: Record<HueScheme, number> = {
  dark: 0.42,
  light: 0.3,
  ink: 0,
  'sorbet-day': 0.85,
  'sorbet-night': 0.6,
  'lavender-day': 0.85,
  'lavender-night': 0.6,
};

/**
 * One fixed colour wash painted under a theme's section glow, the same on
 * every section: an elliptical radial gradient from `color` at its centre
 * to transparent at `fade` (0..1 of the radius). Positions and radii are
 * fractions of the glow band (both apps paint it 420px tall).
 */
export interface GlowAuraLayer {
  color: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fade: number;
}

/** Sorbet's aura: pink top-left, aqua near the middle, lemon lower left. Lavender's: lilac, ice blue, pink opal. */
export const GLOW_AURA: Partial<Record<HueScheme, readonly GlowAuraLayer[]>> = {
  'sorbet-day': [
    { color: '#FFBDE1', cx: 0, cy: 0, rx: 0.75, ry: 0.6, fade: 0.75 },
    { color: '#96F2E6', cx: 0.45, cy: 0.18, rx: 0.7, ry: 0.55, fade: 0.75 },
    { color: '#FFEB9D', cx: 0.15, cy: 0.6, rx: 0.6, ry: 0.4, fade: 0.8 },
  ],
  'sorbet-night': [
    { color: '#84345F', cx: 0, cy: 0, rx: 0.75, ry: 0.6, fade: 0.75 },
    { color: '#00655C', cx: 0.45, cy: 0.18, rx: 0.7, ry: 0.55, fade: 0.75 },
    { color: '#53347E', cx: 0.15, cy: 0.6, rx: 0.6, ry: 0.4, fade: 0.8 },
  ],
  'lavender-day': [
    { color: '#E4D6FF', cx: 0, cy: 0, rx: 0.75, ry: 0.6, fade: 0.75 },
    { color: '#C4ECFF', cx: 0.45, cy: 0.18, rx: 0.7, ry: 0.55, fade: 0.75 },
    { color: '#FFDCF2', cx: 0.15, cy: 0.6, rx: 0.6, ry: 0.4, fade: 0.8 },
  ],
  'lavender-night': [
    { color: '#503975', cx: 0, cy: 0, rx: 0.75, ry: 0.6, fade: 0.75 },
    { color: '#0D4768', cx: 0.45, cy: 0.18, rx: 0.7, ry: 0.55, fade: 0.75 },
    { color: '#542C51', cx: 0.15, cy: 0.6, rx: 0.6, ry: 0.4, fade: 0.8 },
  ],
};

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
  return hueSwatch(sectionHue(sectionId), scheme);
}

/** One hue's swatch for a scheme (the e-paper scheme wears the shared grey, Sorbet its own set). */
export function hueSwatch(hue: SectionHue, scheme: HueScheme): SectionHueSwatch {
  if (scheme === 'ink') return INK_HUE_SWATCH;
  return isHueSetId(scheme) ? HUE_SETS[scheme][hue] : SECTION_HUES[hue][scheme];
}
