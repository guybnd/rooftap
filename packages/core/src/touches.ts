// Hearth §8 "Small touches" (Guy, 2026-11-07): short one-shot motions that
// mark a real moment, shared by both apps. Each takes the motion tokens,
// moves transform and opacity only, and stays still under reduced motion.
import { MOTION_DURATIONS_MS } from './tokens';

// ── Hero roll ─────────────────────────────────────────────────────────────
// A Hero lede's number rolls like an odometer when it changes: counting
// down, the new number drops in from above and the old one falls away;
// counting up, the reverse. Only a change between two numbers rolls.

/** The roll, swift-out (slow + base). */
export const HERO_ROLL_MS = MOTION_DURATIONS_MS.slow + MOTION_DURATIONS_MS.base;

/** A Hero value as a number: 3, "12", "$1,115", "-$40". Null for words ("All clear"). */
export function heroNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const m = /^([-+]?)[$€£¥]?(\d[\d,]*(?:\.\d+)?)%?$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ''));
  return m[1] === '-' ? -n : n;
}

/**
 * Which way a Hero value rolls from `from` to `to`: -1 counting down (the new
 * number drops in from above), 1 counting up (it rises from below), 0 when it
 * doesn't roll (no change, or either side isn't a number).
 */
export function heroRollDirection(from: unknown, to: unknown): -1 | 0 | 1 {
  const a = heroNumber(from);
  const b = heroNumber(to);
  if (a === null || b === null || a === b) return 0;
  return b < a ? -1 : 1;
}

// ── Roof dots ─────────────────────────────────────────────────────────────
// Six dots that fly out of a thing and settle into the Rooftap roof over it
// (the mark's open chevron), then drift up and fade. The All clear moment
// lands with them over its check.

/** The dots fly, hold and fade over this long. */
export const ROOF_DOTS_MS = MOTION_DURATIONS_MS.slow * 2 + MOTION_DURATIONS_MS.fast;
/** The dots fly for this share of the time, then hold and fade. */
export const ROOF_DOTS_FLY = 0.6;
/** How far the roof drifts up while it fades, in px. */
export const ROOF_DOTS_DRIFT = 8;

export interface RoofDot {
  /** Where the dot lands, from the centre of the thing, in px (y grows down). */
  x: number;
  y: number;
  /** Diameter in px. */
  size: number;
}

/**
 * Six dots, left to right, along a roof over a thing `width` by `height`:
 * the slopes at about 32°, the eaves `gap` px above its top edge. Pair dot i
 * with the icon's spectrum colour i, or draw them all in one colour.
 */
export function roofDots(width: number, height: number, gap = 6): RoofDot[] {
  const half = Math.min(48, Math.max(16, width / 2));
  const rise = half * 0.62;
  const eaves = -(height / 2) - gap;
  const along = [-1, -0.6, -0.2, 0.2, 0.6, 1];
  return along.map((f, i) => ({
    x: Math.round(f * half * 10) / 10,
    y: Math.round((eaves - rise * (1 - Math.abs(f))) * 10) / 10,
    size: i === 0 || i === along.length - 1 ? 6 : 7,
  }));
}

// ── Hop ───────────────────────────────────────────────────────────────────
// A small squash and hop when something is done in one tap (bins out): it
// squashes, springs up, lands with a little squash and settles.

/** The hop (slow + base). */
export const HOP_MS = MOTION_DURATIONS_MS.slow + MOTION_DURATIONS_MS.base;
/** The hop's keys: share of time, lift in px (up is negative), and squash. */
export const HOP_KEYS = {
  at: [0, 0.15, 0.45, 0.75, 1],
  y: [0, 0, -10, 0, 0],
  scaleX: [1, 1.08, 0.96, 1.05, 1],
  scaleY: [1, 0.9, 1.06, 0.94, 1],
} as const;

// ── Spectrum sweep ────────────────────────────────────────────────────────
// A soft band of the roof colours passes down the screen once, when a whole
// list is done (the last grocery got).

/** The sweep (slow × 2 + fast), ease-in-out. */
export const SPECTRUM_SWEEP_MS = MOTION_DURATIONS_MS.slow * 2 + MOTION_DURATIONS_MS.fast;
/** The band's height, as a share of the screen. */
export const SPECTRUM_SWEEP_BAND = 0.35;
/** Each colour's strength in the band. */
export const SPECTRUM_SWEEP_ALPHA = 0.18;

/** Whether a count that went from `before` to `after` just cleared a list. */
export function justCleared(before: number | null | undefined, after: number): boolean {
  return before != null && before > 0 && after === 0;
}
