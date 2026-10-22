// HOUP-68: NativeWind/Tailwind preset for @homeup/ui.
//
// Plain CommonJS on purpose: NativeWind's Metro build step loads this file
// (and the app-level tailwind.config.js that applies it) with a plain Node
// `require()` — there is no TS/ESM loader in that path, so it cannot import
// `@homeup/core`'s raw .ts source directly (Node's built-in TS support strips
// types fine, but @homeup/core's extensionless relative imports, e.g.
// `export * from './theme-colors'`, aren't valid under strict ESM resolution
// without a bundler in front of them).
//
// So this preset never touches actual color values. It only declares WHICH
// CSS custom properties each token name maps to (`--color-primary`, etc.) —
// the values are resolved from @homeup/core's THEME_TOKENS (oklch -> an "R G
// B" channel triplet, via culori) entirely at **app runtime** by
// `src/theme/theme-vars.ts` / `ThemeProvider`, using NativeWind's `vars()`.
// That's also what makes theme switching possible with zero preset/component
// changes — only ThemeProvider's active theme id needs to change.
//
// Colors are wrapped `rgb(var(--color-x) / <alpha-value>)` (Tailwind v3's
// documented CSS-variable-with-opacity-modifier recipe) rather than a flat
// `var(--color-x)` — the ported kit uses opacity modifiers pervasively
// (`bg-primary/15`, `bg-accent/50`, ...); a bare `var()` reference would make
// those silently no-op since there'd be no channel triplet for Tailwind to
// splice an alpha onto.
//
// Mirrors @homeup/core/src/theme-colors.ts's THEME_COLOR_KEYS — keep in sync
// if that list changes there.
const THEME_COLOR_KEYS = [
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
];

// Mirrors @homeup/core/src/tokens.ts's TYPE_SCALE. T1 ("themes are the
// variable, type is the constant") means these are safe to inline as literal
// numbers here — they never vary by theme.
//
// HOUP-298: `weight` is the web target (what next/font's variable-weight
// axis renders exactly); `fontFamily` is the nearest static cut actually
// loaded on native for that step (see app/_layout.tsx's useFonts call) —
// weight rides with the step's face below since native can't vary a single
// registered font's weight (see FONT_FAMILY's comment).
const TYPE_SCALE = {
  // The hero steps' face comes from the `.text-hero*` utilities below
  // (per-theme `--font-hero`), not from this fontFamily.
  hero: { sizePx: 88, weight: "800", trackingEm: -0.045, lineHeightPx: 84, fontFamily: "BricolageGrotesque_800ExtraBold" },
  "hero-section": { sizePx: 64, weight: "800", trackingEm: -0.04, lineHeightPx: 62, fontFamily: "BricolageGrotesque_800ExtraBold" },
  display: { sizePx: 24, weight: "700", trackingEm: -0.02, fontFamily: "BricolageGrotesque_700Bold" },
  title: { sizePx: 16, weight: "640", fontFamily: "BricolageGrotesque_600SemiBold" },
  body: { sizePx: 14, weight: "570", fontFamily: "Geist_600SemiBold" },
  caption: { sizePx: 12, weight: "500", fontFamily: "Geist_500Medium" },
  "data-fragment": { sizePx: 12, weight: "570", fontFamily: "GeistMono_600SemiBold" },
  "micro-label": { sizePx: 10.5, weight: "680", trackingEm: 0.1, fontFamily: "Geist_700Bold" },
};

// Mirrors @homeup/core/src/tokens.ts's MOTION_DURATIONS_MS / MOTION_EASE.
const MOTION_DURATIONS_MS = { fast: 150, base: 200, slow: 300, exit: 250, settle: 240 };
const MOTION_EASE = { out: "cubic-bezier(0.16, 1, 0.3, 1)", in: "ease-in" };

// HOUP-170: unlike web (next/font loads Geist/Geist Mono/Bricolage Grotesque
// as variable fonts, so arbitrary TYPE_SCALE weights like 570/640/650 render
// exactly), React Native can't interpolate a variable font's weight axis via
// the `fontWeight` style — each weight has to be its own registered
// `fontFamily` name, and `fontWeight` is inert on custom native fonts. These
// are bare native font names, not CSS font-stack strings — NativeWind needs
// a single resolvable name per class, unlike web's comma-separated fallback
// lists.
//
// HOUP-298: each role's cut here MUST match its un-stepped body cut in
// TYPE_SCALE above (heading<->title, sans<->body, mono<->data-fragment) —
// otherwise a bare `<Text>`/`font-sans` render (packages/ui's Text
// primitive defaults to `font-sans`) diverges in weight from the same text
// stepped via `text-body`/`text-data-fragment`.
const FONT_FAMILY = {
  heading: "BricolageGrotesque_600SemiBold",
  sans: "Geist_600SemiBold",
  mono: "GeistMono_600SemiBold",
};

const plugin = require("tailwindcss/plugin");

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      fontFamily: FONT_FAMILY,
      colors: Object.fromEntries(
        THEME_COLOR_KEYS.map((key) => [key, `rgb(var(--color-${key}) / <alpha-value>)`])
      ),
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      fontSize: Object.fromEntries(
        Object.entries(TYPE_SCALE).map(([step, spec]) => [
          step,
          [
            `${spec.sizePx}px`,
            {
              // fontWeight is inert on native custom fonts (see FONT_FAMILY's
              // comment) — the step's target weight is baked into which
              // static cut fontFamily names instead.
              fontFamily: spec.fontFamily,
              ...(spec.trackingEm !== undefined ? { letterSpacing: `${spec.trackingEm}em` } : {}),
              // Hearth v2: the hero step sets its own line height — RN's
              // default line box for an 88px face leaves a tall empty band
              // above the cap height.
              ...(spec.lineHeightPx !== undefined ? { lineHeight: `${spec.lineHeightPx}px` } : {}),
            },
          ],
        ])
      ),
      transitionDuration: Object.fromEntries(
        Object.entries(MOTION_DURATIONS_MS).map(([name, ms]) => [name, `${ms}ms`])
      ),
      transitionTimingFunction: MOTION_EASE,
    },
  },
  // `.cap-inscription` marks group labels. It used to switch to Cinzel under
  // the retired Axis Mundi themes; it now reads `--font-inscription`, which
  // theme-vars.ts sets to the body face on every theme.
  plugins: [
    plugin(function ({ addUtilities }) {
      addUtilities({
        ".cap-inscription": {
          fontFamily: "var(--font-inscription)",
        },
        // Tailwind's fontSize entries drop a `fontFamily` key, so the hero
        // steps set their face here, from the per-theme `--font-hero` var
        // (Bricolage 800, or Sorbet's Fredoka).
        ".text-hero": {
          fontFamily: "var(--font-hero)",
        },
        ".text-hero-section": {
          fontFamily: "var(--font-hero)",
        },
      });
    }),
  ],
};
