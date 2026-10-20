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
// device" preference resolves to, see theme-preference.ts); the Axis Mundi
// pair (HOUP-295) stays selectable. Day before night within each pair.
export const THEME_IDS = [
  "ember-day",
  "ember-night",
  "axis-mundi-day",
  "axis-mundi-night",
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
  "axis-mundi-day": {
    radius: "0.3125rem",
    colors: {
      "background": "oklch(0.953 0.010 88)",
      "foreground": "oklch(0.258 0.015 297)",
      "card": "oklch(0.982 0.008 92)",
      "card-foreground": "oklch(0.258 0.015 297)",
      "popover": "oklch(0.982 0.008 92)",
      "popover-foreground": "oklch(0.258 0.015 297)",
      "primary": "oklch(0.610 0.116 79.4)",
      "primary-foreground": "oklch(0.166 0.006 301)",
      "secondary": "oklch(0.90 0.01 88)",
      "secondary-foreground": "oklch(0.32 0.015 296)",
      "muted": "oklch(0.91 0.008 88)",
      "muted-foreground": "oklch(0.50 0.014 293)",
      "accent": "oklch(0.89 0.012 88)",
      "accent-foreground": "oklch(0.258 0.015 297)",
      "destructive": "oklch(0.55 0.20 25)",
      "success": "oklch(59.6% 0.145 163.225)",
      "success-foreground": "oklch(1 0 0)",
      "warning": "oklch(66.6% 0.179 58.318)",
      "warning-foreground": "oklch(1 0 0)",
      "border": "oklch(0.84 0.012 88)",
      "input": "oklch(0.94 0.008 90)",
      "ring": "oklch(0.52 0.19 258)",
      "axis": "oklch(0.610 0.116 79.4)",
      "sidebar": "oklch(0.22 0.014 296)",
      "sidebar-foreground": "oklch(0.90 0.01 88)",
      "sidebar-primary": "oklch(0.610 0.116 79.4)",
      "sidebar-primary-foreground": "oklch(0.166 0.006 301)",
      "sidebar-accent": "oklch(0.28 0.016 296)",
      "sidebar-accent-foreground": "oklch(0.93 0.01 88)",
      "sidebar-border": "oklch(0.34 0.016 296)",
      "sidebar-ring": "oklch(0.62 0.17 258)",
    },
    material: {
      // HOUP-169: halved from 0.6/0.12 - full-strength shadow stacked with
      // the card's own border read as a doubled edge on this light theme.
      cardShadow: "0 1px 0 oklch(0.80 0.015 90 / 0.3), 0 2px 8px oklch(0.30 0.02 90 / 0.06)",
      glass: {
        bg: "oklch(0.982 0.008 92 / 1)",
        border: "oklch(0.84 0.012 88 / 1)",
        highlight: "oklch(1 0 0 / 0)",
        shadow: "oklch(0 0 0 / 0)",
      },
      texture: { kind: "none", opacity: 0 },
    },
  },
  "axis-mundi-night": {
    radius: "0.3125rem",
    colors: {
      "background": "oklch(0.166 0.006 301)",
      "foreground": "oklch(0.932 0.013 87)",
      "card": "oklch(0.245 0.016 297)",
      "card-foreground": "oklch(0.932 0.013 87)",
      "popover": "oklch(0.245 0.016 297)",
      "popover-foreground": "oklch(0.932 0.013 87)",
      "primary": "oklch(0.751 0.130 79.8)",
      "primary-foreground": "oklch(0.166 0.006 301)",
      "secondary": "oklch(0.25 0.012 298)",
      "secondary-foreground": "oklch(0.85 0.012 87)",
      "muted": "oklch(0.305 0.01 298)",
      "muted-foreground": "oklch(0.68 0.015 90)",
      "accent": "oklch(0.235 0.014 297)",
      "accent-foreground": "oklch(0.932 0.013 87)",
      "destructive": "oklch(0.60 0.20 22)",
      "success": "oklch(59.6% 0.145 163.225)",
      "success-foreground": "oklch(1 0 0)",
      "warning": "oklch(66.6% 0.179 58.318)",
      "warning-foreground": "oklch(1 0 0)",
      "border": "oklch(0.36 0.014 298)",
      "input": "oklch(0.24 0.012 297)",
      "ring": "oklch(0.70 0.15 255)",
      "axis": "oklch(0.751 0.130 79.8)",
      "sidebar": "oklch(0.198 0.018 295)",
      "sidebar-foreground": "oklch(0.85 0.012 87)",
      "sidebar-primary": "oklch(0.751 0.130 79.8)",
      "sidebar-primary-foreground": "oklch(0.166 0.006 301)",
      "sidebar-accent": "oklch(0.25 0.016 296)",
      "sidebar-accent-foreground": "oklch(0.932 0.013 87)",
      "sidebar-border": "oklch(0.34 0.016 296)",
      "sidebar-ring": "oklch(0.70 0.15 255)",
    },
    material: {
      cardShadow: "0 1px 0 oklch(0.08 0.01 300 / 0.6), 0 3px 10px oklch(0 0 0 / 0.4)",
      glass: {
        bg: "oklch(0.245 0.016 297 / 1)",
        border: "oklch(0.36 0.014 298 / 1)",
        highlight: "oklch(1 0 0 / 0.04)",
        shadow: "oklch(0 0 0 / 0)",
      },
      texture: { kind: "none", opacity: 0 },
    },
  },
};
