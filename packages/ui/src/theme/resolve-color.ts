// HOUP-68: oklch -> sRGB resolution for native color engines (RN cannot parse
// `oklch(...)` CSS color functions the way a browser can). Runs once per
// theme activation, not per render — see `theme-vars.ts`.
//
// Output is a space-separated "R G B" channel triplet (0-255 ints), NOT a hex
// string: Tailwind v3's (NativeWind's supported line) opacity-modifier
// mechanism (`bg-primary/50`, used throughout the ported kit) requires a
// custom color's CSS variable to hold bare channels so `rgb(var(--x) /
// <alpha-value>)` — see tailwind-preset.js — is valid CSS/NativeWind syntax.
// A flat hex value would make every `/NN` opacity modifier a silent no-op.
//
// Gamut mapping: `clampChroma` (perceptual-compress) rather than a hard clip.
// `apps/web/src/app/globals.css` renders in whatever gamut the browser/display
// supports (often P3, wider than sRGB); RN's color engine only understands
// sRGB. A few Hearth theme colors sit outside sRGB — clamping chroma while
// preserving lightness/hue degrades gracefully (a slightly less saturated
// color) instead of hard-clipping to a channel extreme, which can crush a
// color toward grey/black at the edges of the gamut.
import { clampChroma, converter, parse } from 'culori';

const toRgb = converter('rgb');
const toOklch = converter('oklch');

function channel(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

/**
 * Resolves an oklch (optionally `oklch(... / alpha)`) token to an "R G B"
 * channel triplet. Any intrinsic alpha on the token itself is intentionally
 * dropped here — Tailwind's `<alpha-value>` modifier owns alpha at the
 * *usage* site (`bg-card/50`), and composing an intrinsic token alpha with
 * that mechanism isn't representable as one CSS variable. The usage-site
 * `<alpha-value>` mechanism is what actually renders translucency.
 */
export function resolveOklchToRgbTriplet(oklch: string): string {
  const parsed = parse(oklch);
  if (!parsed) {
    throw new Error(`resolveOklchToRgbTriplet: unresolvable color token "${oklch}"`);
  }
  const clamped = clampChroma(parsed, 'oklch');
  const rgb = toRgb(clamped);
  if (!rgb) {
    throw new Error(`resolveOklchToRgbTriplet: culori could not convert "${oklch}"`);
  }
  return `${channel(rgb.r)} ${channel(rgb.g)} ${channel(rgb.b)}`;
}

function roundAlpha(alpha: number): number {
  return Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000;
}

/**
 * HOUP-132: alpha-preserving sibling to resolveOklchToRgbTriplet, for
 * material tokens (glass fills, shadow colors) consumed directly as style
 * values rather than through Tailwind's `<alpha-value>` modifier — here the
 * token's own intrinsic alpha (e.g. a translucent glass fill's
 * `oklch(... / 0.55)`) must survive instead of being dropped.
 *
 * Emits the comma `rgba(r, g, b, a)` form rather than CSS Color 4's
 * `rgb(r g b / a)` space form: RN's style/color parser reliably accepts the
 * former on both platforms, not always the latter.
 */
export function resolveOklchToRgba(oklch: string): string {
  const parsed = parse(oklch);
  if (!parsed) {
    throw new Error(`resolveOklchToRgba: unresolvable color token "${oklch}"`);
  }
  const clamped = clampChroma(parsed, 'oklch');
  const rgb = toRgb(clamped);
  if (!rgb) {
    throw new Error(`resolveOklchToRgba: culori could not convert "${oklch}"`);
  }
  const alpha = roundAlpha(rgb.alpha ?? 1);
  return `rgba(${channel(rgb.r)}, ${channel(rgb.g)}, ${channel(rgb.b)}, ${alpha})`;
}

/**
 * True when an oklch token's lightness (L) is above the midpoint — the
 * threshold that separates the app's dark theme (axis-mundi-night) from its
 * bright one (axis-mundi-day). Used to
 * pick native chrome (status bar) icon contrast: dark icons on light
 * surfaces, light icons on dark ones.
 */
export function isLightOklch(oklch: string): boolean {
  const parsed = parse(oklch);
  if (!parsed) {
    throw new Error(`isLightOklch: unresolvable color token "${oklch}"`);
  }
  const ok = toOklch(parsed);
  if (!ok) {
    throw new Error(`isLightOklch: culori could not convert "${oklch}" to oklch`);
  }
  return ok.l > 0.5;
}

const OKLCH_TOKEN_RE = /oklch\([^)]*\)/g;

/**
 * HOUP-132: rewrites every embedded `oklch(...)` color in a (possibly
 * multi-layer, possibly literal `"none"`) CSS box-shadow string through
 * resolveOklchToRgba, leaving offsets/blur/spread/`inset` untouched.
 * globals.css's `--card-shadow` tokens are authored exactly this way (e.g.
 * `"0 2px 12px oklch(0 0 0 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.03)"`), so
 * the result is a literal string RN's `boxShadow` style prop can consume.
 */
export function resolveBoxShadowOklch(boxShadow: string): string {
  if (boxShadow.trim() === 'none') return 'none';
  return boxShadow.replace(OKLCH_TOKEN_RE, (match) => resolveOklchToRgba(match));
}
