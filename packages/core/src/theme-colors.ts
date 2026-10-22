// AUTO-EXTRACTED (HOUP-67) from apps/web/src/app/globals.css — do not hand-edit
// the color/radius values in THEME_TOKENS[x].colors/.radius below; regenerate
// them if globals.css's theme blocks change (see the parity test in apps/web
// for the drift check).
//
// The `material` field on each theme entry (HOUP-132) is a SEPARATE,
// HAND-AUTHORED block mirroring globals.css's --card-shadow/--glass-*/
// --body-texture/--texture-opacity custom properties (no generator exists for
// it either, same as colors) — update it by hand alongside globals.css, and
// keep apps/web/src/app/globals-tokens-parity.test.ts's material assertions
// passing as the drift guard.
//
// Type export lives in tokens.ts alongside the hand-authored scale tokens.

export const THEME_COLOR_KEYS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "border",
  "input",
  "ring",
  "axis",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

// HOUP-132: globals.css's per-theme `body::before` background-image rule —
// "none" themes render nothing. Every shipping theme is "none" today
// (HOUP-295 cut the textured themes); the other kinds remain for
// packages/ui's BackgroundTexture renderer should a textured theme return.
export type BodyTextureKind = "none" | "grid" | "dashed" | "dots";

export interface ThemeGlassTokens {
  /** `--glass-bg` */
  bg: string;
  /** `--glass-border` */
  border: string;
  /** `--glass-highlight` */
  highlight: string;
  /** `--glass-shadow` */
  shadow: string;
}

export interface ThemeTextureTokens {
  kind: BodyTextureKind;
  /** `--texture-opacity` */
  opacity: number;
}

export interface ThemeMaterial {
  /**
   * `--card-shadow` verbatim — a (possibly multi-layer, possibly "none") CSS
   * box-shadow string with embedded `oklch(...)` colors. Resolved to an
   * alpha-preserving RN-friendly string by packages/ui's theme bridge
   * (resolve-color.ts's `resolveBoxShadowOklch`), not consumed raw.
   */
  cardShadow: string;
  glass: ThemeGlassTokens;
  texture: ThemeTextureTokens;
}

export interface ThemeTokens {
  radius: string;
  colors: Record<ThemeColorKey, string>;
  material: ThemeMaterial;
}

// Hearth v2: the Ember pair leads (it is what the default "follow the
// device" preference resolves to, see theme-preference.ts). The Axis Mundi
// pair (HOUP-295) was retired; a stored Axis preference no longer parses and
// falls back to "system". Day before night within each pair.
// E-Ink (revived after HOUP-295 cut the old one) is a single flat, still,
// greyscale theme for e-paper screens (see STILL_THEME_IDS). The Sorbet
// pair is the playful pastel one: gummy section hues (section-hues.ts
// HUE_SETS), a mango accent with dark text and a rainbow aura behind the glow.
// The Lavender pair is the dreamy one: lilac mist by day, plum dusk by night,
// a violet accent and an opal aura.
export const THEME_IDS = [
  "ember-day",
  "ember-night",
  "e-ink",
  "sorbet-day",
  "sorbet-night",
  "lavender-day",
  "lavender-night",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_TOKENS: Record<ThemeId, ThemeTokens> = {
  "ember-day": {
    radius: "1.125rem",
    colors: {
      "background": "oklch(0.965 0.006 75.4)",
      "foreground": "oklch(0.222 0.018 305.1)",
      "card": "oklch(1 0 0)",
      "card-foreground": "oklch(0.222 0.018 305.1)",
      "popover": "oklch(1 0 0)",
      "popover-foreground": "oklch(0.222 0.018 305.1)",
      "primary": "oklch(0.571 0.171 33.8)",
      "primary-foreground": "oklch(1 0 0)",
      "secondary": "oklch(0.93 0.01 72.7)",
      "secondary-foreground": "oklch(0.295 0.021 305.7)",
      "muted": "oklch(0.939 0.01 72.7)",
      "muted-foreground": "oklch(0.517 0.023 304.9)",
      "accent": "oklch(0.93 0.01 72.7)",
      "accent-foreground": "oklch(0.222 0.018 305.1)",
      "destructive": "oklch(0.572 0.197 15.9)",
      "success": "oklch(0.553 0.118 160.1)",
      "success-foreground": "oklch(1 0 0)",
      "warning": "oklch(0.551 0.125 63.9)",
      "warning-foreground": "oklch(1 0 0)",
      "border": "oklch(0.909 0.012 71.9)",
      "input": "oklch(0.945 0.01 72.7)",
      "ring": "oklch(0.571 0.171 33.8)",
      "axis": "oklch(0.571 0.171 33.8)",
      "sidebar": "oklch(0.983 0.005 78.3)",
      "sidebar-foreground": "oklch(0.295 0.021 305.7)",
      "sidebar-primary": "oklch(0.571 0.171 33.8)",
      "sidebar-primary-foreground": "oklch(1 0 0)",
      "sidebar-accent": "oklch(0.939 0.01 72.7)",
      "sidebar-accent-foreground": "oklch(0.222 0.018 305.1)",
      "sidebar-border": "oklch(0.909 0.012 71.9)",
      "sidebar-ring": "oklch(0.571 0.171 33.8)",
    },
    material: {
      cardShadow: "0 1px 2px oklch(0.3 0.03 50 / 0.05), 0 10px 28px oklch(0.3 0.03 50 / 0.07)",
      glass: {
        bg: "oklch(1 0 0 / 1)",
        border: "oklch(0.909 0.012 71.9 / 1)",
        highlight: "oklch(1 0 0 / 0)",
        shadow: "oklch(0 0 0 / 0)",
      },
      texture: { kind: "none", opacity: 0 },
    },
  },
  "ember-night": {
    radius: "1.125rem",
    colors: {
      "background": "oklch(0.178 0.013 300.4)",
      "foreground": "oklch(0.963 0.009 78.3)",
      "card": "oklch(0.221 0.018 300.2)",
      "card-foreground": "oklch(0.963 0.009 78.3)",
      "popover": "oklch(0.221 0.018 300.2)",
      "popover-foreground": "oklch(0.963 0.009 78.3)",
      "primary": "oklch(0.729 0.169 34.1)",
      "primary-foreground": "oklch(0.176 0.025 42.3)",
      "secondary": "oklch(0.262 0.023 300.1)",
      "secondary-foreground": "oklch(0.915 0.013 75.4)",
      "muted": "oklch(0.262 0.023 300.1)",
      "muted-foreground": "oklch(0.713 0.025 301.8)",
      "accent": "oklch(0.262 0.023 300.1)",
      "accent-foreground": "oklch(0.963 0.009 78.3)",
      "destructive": "oklch(0.716 0.181 13.8)",
      "success": "oklch(0.771 0.153 156.2)",
      "success-foreground": "oklch(0.257 0.046 156.7)",
      "warning": "oklch(0.824 0.149 73.3)",
      "warning-foreground": "oklch(0.233 0.049 77.5)",
      "border": "oklch(0.286 0.022 300.2)",
      "input": "oklch(0.234 0.019 298.6)",
      "ring": "oklch(0.729 0.169 34.1)",
      "axis": "oklch(0.729 0.169 34.1)",
      "sidebar": "oklch(0.194 0.017 302)",
      "sidebar-foreground": "oklch(0.915 0.013 75.4)",
      "sidebar-primary": "oklch(0.729 0.169 34.1)",
      "sidebar-primary-foreground": "oklch(0.176 0.025 42.3)",
      "sidebar-accent": "oklch(0.253 0.021 301.5)",
      "sidebar-accent-foreground": "oklch(0.963 0.009 78.3)",
      "sidebar-border": "oklch(0.286 0.022 300.2)",
      "sidebar-ring": "oklch(0.729 0.169 34.1)",
    },
    material: {
      cardShadow: "none",
      glass: {
        bg: "oklch(0.221 0.018 300.2 / 1)",
        border: "oklch(0.286 0.022 300.2 / 1)",
        highlight: "oklch(1 0 0 / 0.03)",
        shadow: "oklch(0 0 0 / 0)",
      },
      texture: { kind: "none", opacity: 0 },
    },
  },
  "e-ink": {
    radius: "0.75rem",
    colors: {
      "background": "oklch(0.95 0 0)",
      "foreground": "oklch(0.16 0 0)",
      "card": "oklch(0.985 0 0)",
      "card-foreground": "oklch(0.16 0 0)",
      "popover": "oklch(0.985 0 0)",
      "popover-foreground": "oklch(0.16 0 0)",
      "primary": "oklch(0.16 0 0)",
      "primary-foreground": "oklch(0.985 0 0)",
      "secondary": "oklch(0.9 0 0)",
      "secondary-foreground": "oklch(0.16 0 0)",
      "muted": "oklch(0.91 0 0)",
      "muted-foreground": "oklch(0.42 0 0)",
      "accent": "oklch(0.89 0 0)",
      "accent-foreground": "oklch(0.16 0 0)",
      "destructive": "oklch(0.3 0 0)",
      "success": "oklch(0.35 0 0)",
      "success-foreground": "oklch(0.985 0 0)",
      "warning": "oklch(0.45 0 0)",
      "warning-foreground": "oklch(0.985 0 0)",
      "border": "oklch(0.78 0 0)",
      "input": "oklch(0.8 0 0)",
      "ring": "oklch(0.16 0 0)",
      "axis": "oklch(0.16 0 0)",
      "sidebar": "oklch(0.97 0 0)",
      "sidebar-foreground": "oklch(0.22 0 0)",
      "sidebar-primary": "oklch(0.16 0 0)",
      "sidebar-primary-foreground": "oklch(0.985 0 0)",
      "sidebar-accent": "oklch(0.9 0 0)",
      "sidebar-accent-foreground": "oklch(0.16 0 0)",
      "sidebar-border": "oklch(0.78 0 0)",
      "sidebar-ring": "oklch(0.16 0 0)",
    },
    material: {
      // Flat: no shadow, glass edge or texture survives an e-paper refresh.
      cardShadow: "none",
      glass: {
        bg: "oklch(0.985 0 0 / 1)",
        border: "oklch(0.78 0 0 / 1)",
        highlight: "oklch(1 0 0 / 0)",
        shadow: "oklch(0 0 0 / 0)",
      },
      texture: { kind: "none", opacity: 0 },
    },
  },
  "sorbet-day": {
    radius: "1.75rem",
    colors: {
      "background": "oklch(0.985 0.01 60)",
      "foreground": "oklch(0.27 0.03 300)",
      "card": "oklch(1 0 0)",
      "card-foreground": "oklch(0.27 0.03 300)",
      "popover": "oklch(1 0 0)",
      "popover-foreground": "oklch(0.27 0.03 300)",
      "primary": "oklch(0.71 0.18 54)",
      "primary-foreground": "oklch(0.25 0.05 40)",
      "secondary": "oklch(0.945 0.014 60)",
      "secondary-foreground": "oklch(0.33 0.03 300)",
      "muted": "oklch(0.95 0.013 60)",
      "muted-foreground": "oklch(0.52 0.035 300)",
      "accent": "oklch(0.945 0.014 60)",
      "accent-foreground": "oklch(0.27 0.03 300)",
      "destructive": "oklch(0.572 0.197 15.9)",
      "success": "oklch(0.553 0.118 160.1)",
      "success-foreground": "oklch(1 0 0)",
      "warning": "oklch(0.551 0.125 63.9)",
      "warning-foreground": "oklch(1 0 0)",
      "border": "oklch(0.925 0.016 60)",
      "input": "oklch(0.955 0.012 60)",
      "ring": "oklch(0.71 0.18 54)",
      "axis": "oklch(0.71 0.18 54)",
      "sidebar": "oklch(0.995 0.008 60)",
      "sidebar-foreground": "oklch(0.33 0.03 300)",
      "sidebar-primary": "oklch(0.71 0.18 54)",
      "sidebar-primary-foreground": "oklch(0.25 0.05 40)",
      "sidebar-accent": "oklch(0.95 0.013 60)",
      "sidebar-accent-foreground": "oklch(0.27 0.03 300)",
      "sidebar-border": "oklch(0.925 0.016 60)",
      "sidebar-ring": "oklch(0.71 0.18 54)",
    },
    material: {
      cardShadow: "0 1px 2px oklch(0.4 0.06 30 / 0.06), 0 12px 30px oklch(0.4 0.08 30 / 0.08)",
      glass: {
        bg: "oklch(1 0 0 / 1)",
        border: "oklch(0.925 0.016 60 / 1)",
        highlight: "oklch(1 0 0 / 0)",
        shadow: "oklch(0 0 0 / 0)",
      },
      texture: { kind: "none", opacity: 0 },
    },
  },
  "sorbet-night": {
    radius: "1.75rem",
    colors: {
      "background": "oklch(0.2 0.03 290)",
      "foreground": "oklch(0.95 0.015 290)",
      "card": "oklch(0.245 0.034 290)",
      "card-foreground": "oklch(0.95 0.015 290)",
      "popover": "oklch(0.245 0.034 290)",
      "popover-foreground": "oklch(0.95 0.015 290)",
      "primary": "oklch(0.8 0.16 62)",
      "primary-foreground": "oklch(0.22 0.05 40)",
      "secondary": "oklch(0.285 0.036 290)",
      "secondary-foreground": "oklch(0.9 0.02 290)",
      "muted": "oklch(0.285 0.036 290)",
      "muted-foreground": "oklch(0.74 0.04 290)",
      "accent": "oklch(0.285 0.036 290)",
      "accent-foreground": "oklch(0.95 0.015 290)",
      "destructive": "oklch(0.716 0.181 13.8)",
      "success": "oklch(0.771 0.153 156.2)",
      "success-foreground": "oklch(0.257 0.046 156.7)",
      "warning": "oklch(0.824 0.149 73.3)",
      "warning-foreground": "oklch(0.233 0.049 77.5)",
      "border": "oklch(0.31 0.033 290)",
      "input": "oklch(0.255 0.03 290)",
      "ring": "oklch(0.8 0.16 62)",
      "axis": "oklch(0.8 0.16 62)",
      "sidebar": "oklch(0.215 0.03 290)",
      "sidebar-foreground": "oklch(0.9 0.02 290)",
      "sidebar-primary": "oklch(0.8 0.16 62)",
      "sidebar-primary-foreground": "oklch(0.22 0.05 40)",
      "sidebar-accent": "oklch(0.275 0.033 290)",
      "sidebar-accent-foreground": "oklch(0.95 0.015 290)",
      "sidebar-border": "oklch(0.31 0.033 290)",
      "sidebar-ring": "oklch(0.8 0.16 62)",
    },
    material: {
      cardShadow: "none",
      glass: {
        bg: "oklch(0.245 0.034 290 / 1)",
        border: "oklch(0.31 0.033 290 / 1)",
        highlight: "oklch(1 0 0 / 0)",
        shadow: "oklch(0 0 0 / 0)",
      },
      texture: { kind: "none", opacity: 0 },
    },
  },
  "lavender-day": {
    radius: "1.5rem",
    colors: {
      "background": "oklch(0.97 0.025 300)",
      "foreground": "oklch(0.3 0.05 300)",
      "card": "oklch(0.995 0.009 300)",
      "card-foreground": "oklch(0.3 0.05 300)",
      "popover": "oklch(0.995 0.009 300)",
      "popover-foreground": "oklch(0.3 0.05 300)",
      "primary": "oklch(0.55 0.17 295)",
      "primary-foreground": "oklch(1 0 0)",
      "secondary": "oklch(0.93 0.035 300)",
      "secondary-foreground": "oklch(0.33 0.04 300)",
      "muted": "oklch(0.935 0.033 300)",
      "muted-foreground": "oklch(0.52 0.04 300)",
      "accent": "oklch(0.93 0.035 300)",
      "accent-foreground": "oklch(0.3 0.05 300)",
      "destructive": "oklch(0.572 0.197 15.9)",
      "success": "oklch(0.553 0.118 160.1)",
      "success-foreground": "oklch(1 0 0)",
      "warning": "oklch(0.551 0.125 63.9)",
      "warning-foreground": "oklch(1 0 0)",
      "border": "oklch(0.91 0.04 300)",
      "input": "oklch(0.94 0.03 300)",
      "ring": "oklch(0.55 0.17 295)",
      "axis": "oklch(0.55 0.17 295)",
      "sidebar": "oklch(0.98 0.02 300)",
      "sidebar-foreground": "oklch(0.33 0.04 300)",
      "sidebar-primary": "oklch(0.55 0.17 295)",
      "sidebar-primary-foreground": "oklch(1 0 0)",
      "sidebar-accent": "oklch(0.935 0.033 300)",
      "sidebar-accent-foreground": "oklch(0.3 0.05 300)",
      "sidebar-border": "oklch(0.91 0.04 300)",
      "sidebar-ring": "oklch(0.55 0.17 295)",
    },
    material: {
      cardShadow: "0 1px 2px oklch(0.4 0.06 300 / 0.06), 0 12px 30px oklch(0.4 0.08 300 / 0.08)",
      glass: {
        bg: "oklch(0.995 0.009 300 / 1)",
        border: "oklch(0.91 0.04 300 / 1)",
        highlight: "oklch(1 0 0 / 0)",
        shadow: "oklch(0 0 0 / 0)",
      },
      texture: { kind: "none", opacity: 0 },
    },
  },
  "lavender-night": {
    radius: "1.5rem",
    colors: {
      "background": "oklch(0.215 0.045 305)",
      "foreground": "oklch(0.95 0.015 305)",
      "card": "oklch(0.26 0.052 305)",
      "card-foreground": "oklch(0.95 0.015 305)",
      "popover": "oklch(0.26 0.052 305)",
      "popover-foreground": "oklch(0.95 0.015 305)",
      "primary": "oklch(0.8 0.12 300)",
      "primary-foreground": "oklch(0.24 0.06 300)",
      "secondary": "oklch(0.3 0.054 305)",
      "secondary-foreground": "oklch(0.9 0.02 305)",
      "muted": "oklch(0.3 0.054 305)",
      "muted-foreground": "oklch(0.74 0.04 305)",
      "accent": "oklch(0.3 0.054 305)",
      "accent-foreground": "oklch(0.95 0.015 305)",
      "destructive": "oklch(0.716 0.181 13.8)",
      "success": "oklch(0.771 0.153 156.2)",
      "success-foreground": "oklch(0.257 0.046 156.7)",
      "warning": "oklch(0.824 0.149 73.3)",
      "warning-foreground": "oklch(0.233 0.049 77.5)",
      "border": "oklch(0.325 0.05 305)",
      "input": "oklch(0.27 0.045 305)",
      "ring": "oklch(0.8 0.12 300)",
      "axis": "oklch(0.8 0.12 300)",
      "sidebar": "oklch(0.23 0.045 305)",
      "sidebar-foreground": "oklch(0.9 0.02 305)",
      "sidebar-primary": "oklch(0.8 0.12 300)",
      "sidebar-primary-foreground": "oklch(0.24 0.06 300)",
      "sidebar-accent": "oklch(0.29 0.05 305)",
      "sidebar-accent-foreground": "oklch(0.95 0.015 305)",
      "sidebar-border": "oklch(0.325 0.05 305)",
      "sidebar-ring": "oklch(0.8 0.12 300)",
    },
    material: {
      cardShadow: "none",
      glass: {
        bg: "oklch(0.26 0.052 305 / 1)",
        border: "oklch(0.325 0.05 305 / 1)",
        highlight: "oklch(1 0 0 / 0)",
        shadow: "oklch(0 0 0 / 0)",
      },
      texture: { kind: "none", opacity: 0 },
    },
  },
};
