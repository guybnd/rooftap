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

// ── Spectrum once ─────────────────────────────────────────────────────────
// A card the Assistant just filled with what it did gets one turn of the
// Ask sheet's spectrum edge as it arrives, then rests plain.

/** The one turn (slow × 3 + base), ease-in-out, fading in and out at its ends. */
export const SPECTRUM_ONCE_MS = MOTION_DURATIONS_MS.slow * 3 + MOTION_DURATIONS_MS.base;
/** A reply this young (ms) is new on screen; older ones were there before. */
export const FRESH_REPLY_MS = 20_000;

/** Whether a message written at `createdAt` is new enough to arrive with a touch. */
export function isFreshReply(createdAt: string | null | undefined, now = Date.now()): boolean {
  const at = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(at) && now - at >= -5_000 && now - at < FRESH_REPLY_MS;
}

// ── Timer done ────────────────────────────────────────────────────────────
// A finished cook timer is waiting for you, so its head keeps a turning
// spectrum ring and a soft pulse until you tap it: the one touch that loops.

/** One turn of the ring. */
export const TIMER_DONE_TURN_MS = 1_400;
/** The pulse swells to this and back once per turn. */
export const TIMER_DONE_PULSE = 1.06;

// ── Cheer burst ───────────────────────────────────────────────────────────
// The coral burst from slide-to-finish, around a thing that earned it: a
// ring that swells off its edge and sparks that fly out. The Costs Hero
// gets it the first time you open a month that finished under its goal,
// with a swell of the number and one mint glow of the meter.

/** The burst (slow + base), swift-out. */
export const CHEER_BURST_MS = MOTION_DURATIONS_MS.slow + MOTION_DURATIONS_MS.base;
/** The number swells to this and back while the sparks fly. */
export const CHEER_SWELL = 1.08;
/** The meter's mint glow, at its strongest. */
export const CHEER_GLOW_ALPHA = 0.6;

export interface CheerSpark {
  /** Where the spark ends, from the centre of the thing, in px (y grows down). */
  x: number;
  y: number;
  /** Diameter in px. */
  size: number;
  /** Coral (true) or the roof colour at `hue` (0 to 5). */
  coral: boolean;
  hue: number;
}

/**
 * `count` sparks round a thing `width` by `height`, each ending `reach` px
 * past its edge: coral and roof colours in turn, big and small in turn.
 */
export function cheerSparks(width: number, height: number, count = 10, reach = 26): CheerSpark[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + 0.4;
    return {
      x: Math.round(Math.cos(angle) * (width / 2 + reach) * 10) / 10,
      y: Math.round(Math.sin(angle) * (height / 2 + reach) * 10) / 10,
      size: i % 2 ? 5 : 7,
      coral: i % 2 === 1,
      hue: Math.floor(i / 2) % 6,
    };
  });
}

// ── Drop in ───────────────────────────────────────────────────────────────
// A row just added from the item sheet arrives with a coral dot that falls
// into its leading slot, then the row pops in where it landed.

/** The dot's fall (slow), ease-in. */
export const DROP_IN_DOT_MS = MOTION_DURATIONS_MS.slow;
/** The row's pop once the dot lands (fast + base). */
export const DROP_IN_POP_MS = MOTION_DURATIONS_MS.fast + MOTION_DURATIONS_MS.base;
/** How far above its landing the dot starts, in px. */
export const DROP_IN_FALL = 28;
/** Where the dot lands: this far in from the row's leading edge, in px (the check). */
export const DROP_IN_LAND_X = 28;
/** The dot's diameter, in px. */
export const DROP_IN_DOT = 10;
/** The row's pop keys: share of time, scale and opacity. */
export const DROP_IN_KEYS = {
  at: [0, 0.43, 1],
  scale: [0.94, 1.015, 1],
  opacity: [0, 1, 1],
} as const;

const dropped = new Set<string>();

/**
 * Whether a just-added row `id` should drop in now: true once per id, so a
 * list that re-renders or recycles the row does not play it again.
 */
export function takeDropIn(id: string): boolean {
  if (dropped.has(id)) return false;
  dropped.add(id);
  return true;
}
