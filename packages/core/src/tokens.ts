// Hearth design tokens (HOUP-67) — spacing, radius, type scale, motion, and
// the haptic vocabulary, plus the per-theme color values re-exported from
// theme-colors.ts (auto-extracted from apps/web/src/app/globals.css).
//
// `globals.css` stays authoritative for web rendering — nothing here changes
// how apps/web looks. This module exists so the future RN app (HOUP-68) has
// a single JS/TS source for the same design language, since RN can't read
// CSS custom properties. A parity test in apps/web asserts the theme color
// set below never silently drifts from globals.css.

export {
  THEME_COLOR_KEYS,
  THEME_IDS,
  THEME_TOKENS,
  type BodyTextureKind,
  type ThemeColorKey,
  type ThemeGlassTokens,
  type ThemeId,
  type ThemeMaterial,
  type ThemeTextureTokens,
  type ThemeTokens,
} from './theme-colors';

// ── Spacing (Hearth §"spacing rhythm") ───────────────────────────────────────
// Rooftap doesn't override Tailwind v4's default spacing scale (no
// `--spacing-*` custom properties in globals.css) — the 4px base unit below
// mirrors that default so a native scale can multiply from the same root.
export const SPACING_BASE_PX = 4;

// ── Radius (Hearth §10, "themes own... radius") ──────────────────────────────
// Each theme's base `--radius` lives in theme-colors.ts (rem string, as
// authored in globals.css). The sm/md/lg/xl relationship mirrors the
// `@theme inline` block in globals.css (`--radius-sm: calc(var(--radius) - 4px)`,
// etc.) — assumes a 16px root font size, which this codebase never overrides.
const REM_PX = 16;

export interface RadiusScale {
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

/** Derive the sm/md/lg/xl radius scale (in px) from a theme's base radius (rem string, e.g. "0.625rem"). */
export function deriveRadiusScale(baseRadiusRem: string): RadiusScale {
  const baseRem = parseFloat(baseRadiusRem);
  const basePx = baseRem * REM_PX;
  return {
    sm: basePx - 4,
    md: basePx - 2,
    lg: basePx,
    xl: basePx + 4,
  };
}

// ── Type scale (Hearth §5, T1-T4) ────────────────────────────────────────────
// Fixed across every theme and section — "themes are the variable, type is
// the constant" (T1). Sizes in px, weight as CSS font-weight, tracking in em.
export type TypeStep = 'hero' | 'heroSection' | 'display' | 'title' | 'body' | 'caption' | 'dataFragment' | 'microLabel';

export interface TypeStepSpec {
  sizePx: number;
  weight: number;
  trackingEm?: number;
  /** Geist Mono, for data fragments; uppercase micro labels also set this true. */
  mono?: boolean;
  uppercase?: boolean;
}

// Hearth v2 (Pulse): `hero` is the one huge number a surface leads with
// ("3 of 7 left today", "12 to buy") — H1's lede, never body copy, at most
// one per surface. Heading face at 800, tight tracking, tabular figures.
// Home leads with `hero`; a section screen leads with the smaller
// `heroSection`, which leaves room for a money value like "$2,340".
export const TYPE_SCALE: Record<TypeStep, TypeStepSpec> = {
  hero: { sizePx: 88, weight: 800, trackingEm: -0.045 },
  heroSection: { sizePx: 64, weight: 800, trackingEm: -0.04 },
  display: { sizePx: 24, weight: 700, trackingEm: -0.02 },
  title: { sizePx: 16, weight: 640 },
  body: { sizePx: 14, weight: 570 },
  caption: { sizePx: 12, weight: 500 },
  dataFragment: { sizePx: 12, weight: 570, mono: true },
  microLabel: { sizePx: 10.5, weight: 680, trackingEm: 0.1, uppercase: true },
};

// ── Motion (Hearth §8, MO) ────────────────────────────────────────────────────
// `transform`/`opacity` only; `prefers-reduced-motion` collapses every
// duration to 0ms (see globals.css's `--motion-*` block) — that collapse is
// a web/CSS-cascade concern, out of scope for this token module.
export type MotionToken = 'fast' | 'base' | 'slow' | 'exit' | 'settle';

export const MOTION_DURATIONS_MS: Record<MotionToken, number> = {
  fast: 150,
  base: 200,
  slow: 300,
  exit: 250,
  settle: 240,
};

export const MOTION_EASE = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  in: 'ease-in',
} as const;

/**
 * `MOTION_EASE.out` as a function of linear time (0 to 1), for motion
 * stepped frame by frame in JS that has to land in step with a CSS or
 * native animation on the same curve (the tab glide follows the page shift
 * this way). Solves the bezier's x for `t`, then reads its y.
 */
export function motionEaseOut(t: number): number {
  'worklet';
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // cubic-bezier(0.16, 1, 0.3, 1) in polynomial form: x(s) = ((ax s + bx) s + cx) s.
  const cx = 3 * 0.16;
  const bx = 3 * (0.3 - 0.16) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * 1;
  const by = 3 * (1 - 1) - cy;
  const ay = 1 - cy - by;
  const x = (s: number) => ((ax * s + bx) * s + cx) * s;
  // Newton from s = t, falling back to bisection if the slope flattens.
  let s = t;
  for (let i = 0; i < 8; i++) {
    const err = x(s) - t;
    if (Math.abs(err) < 1e-6) return ((ay * s + by) * s + cy) * s;
    const slope = (3 * ax * s + 2 * bx) * s + cx;
    if (Math.abs(slope) < 1e-6) break;
    s -= err / slope;
  }
  let lo = 0;
  let hi = 1;
  s = t;
  for (let i = 0; i < 30; i++) {
    const err = x(s) - t;
    if (Math.abs(err) < 1e-6) break;
    if (err > 0) hi = s;
    else lo = s;
    s = (lo + hi) / 2;
  }
  return ((ay * s + by) * s + cy) * s;
}

// ── Haptic vocabulary (Hearth §9, HA) ────────────────────────────────────────
// Just the vocabulary (name -> vibration pattern in ms) — the actual
// `navigator.vibrate` call stays in apps/web/src/lib/haptics.ts (browser-only,
// Android-only; iOS Safari no-ops). RN's haptic engine (Expo Haptics or
// similar) maps its own feedback styles to these same named moments.
export type HapticPulse = 'select' | 'tick' | 'commit' | 'success' | 'warn' | 'error' | 'remove' | 'celebrate';

export const HAPTIC_PATTERNS_MS: Record<HapticPulse, number[]> = {
  select: [6],
  tick: [10],
  commit: [15],
  success: [12, 60, 12],
  warn: [10, 50, 10],
  error: [16, 40, 16, 40, 16],
  remove: [22],
  celebrate: [8, 60, 10, 60, 14, 90, 12, 60, 12],
};

// Effects: sequences that ride a gesture instead of answering one event.
/** Hold to edit: fill fractions where the charge buzzes (soft, then light), before commit() lands it. */
export const HOLD_CHARGE_STEPS = [0.4, 0.72] as const;
/** Slide to finish: track fractions that click on the way out, each a little firmer. */
export const SLIDE_ZIPPER_STEPS = [0.25, 0.5, 0.75] as const;
/** Celebrate: offsets (ms) of the rising roll (light, medium, heavy); success() lands after the last. */
export const CELEBRATE_ROLL_MS = [0, 70, 140, 230] as const;

/**
 * Which of `steps` a value moving from `prev` to `next` has just passed going
 * up (ascending indexes). Going down never fires: a retreating fill or thumb
 * is undoing, not arriving.
 */
export function stepsCrossed(steps: readonly number[], prev: number, next: number): number[] {
  if (next <= prev) return [];
  const crossed: number[] = [];
  steps.forEach((step, i) => {
    if (prev < step && next >= step) crossed.push(i);
  });
  return crossed;
}
