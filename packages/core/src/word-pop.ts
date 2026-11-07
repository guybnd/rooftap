// Hearth §8 "Word pop" (Guy, 2026-11-07): when words in an item's title
// start setting a field ("12am", "tomorrow", "@Sam"), they pop as they light.
// First the word fills with the app icon's roof colours, running through
// them left to right, and jiggles (a small wobble that dies away). Then it
// pops into its coral pill: it drops to 0.82, swells past 1.12 and settles.
// One shot, transform, colour and opacity only, and nothing under reduced
// motion (the word just lights). Both apps run it from these numbers.
import { ROOFTAP_SPECTRUM } from './brand-mark';
import { MOTION_DURATIONS_MS } from './tokens';

/** The rainbow fill and the wobble (slow + fast). */
export const WORD_POP_FILL_MS = MOTION_DURATIONS_MS.slow + MOTION_DURATIONS_MS.fast;
/** The pop into the pill (fast + base, swift-out). */
export const WORD_POP_PILL_MS = MOTION_DURATIONS_MS.fast + MOTION_DURATIONS_MS.base;
/** The whole pop. */
export const WORD_POP_MS = WORD_POP_FILL_MS + WORD_POP_PILL_MS;
/** The pill starts from this scale... */
export const WORD_POP_PILL_FROM = 0.82;
/** ...swells past this at 40% of its time, then settles at 1. */
export const WORD_POP_SWELL = 1.12;
/** The fill's colours, in order: the icon's roof, coral to rose. */
export const WORD_POP_COLORS = ROOFTAP_SPECTRUM;

/** A word in the title, by its place: what a sheet passes as a title mark. */
export interface WordPopMark {
  start: number;
  end: number;
}

/** What a mark is known by between renders: its words, ignoring case and place. */
export function wordPopKey(title: string, mark: WordPopMark): string {
  return title.slice(mark.start, mark.end).trim().toLowerCase();
}

/** The keys of the marks lit now, to hand back to `newWordPops` next time. */
export function wordPopKeys(title: string, marks: readonly WordPopMark[]): string[] {
  return marks.map((m) => wordPopKey(title, m));
}

/**
 * The marks that just lit: in `marks` but not in `before` (keys from
 * `wordPopKeys`). A mark that only moves because words were typed before it
 * keeps its key and does not pop again.
 */
export function newWordPops(before: readonly string[], title: string, marks: readonly WordPopMark[]): WordPopMark[] {
  const seen = new Set(before);
  return marks.filter((m) => {
    const key = wordPopKey(title, m);
    return key.length > 0 && !seen.has(key);
  });
}

/**
 * The wobble at `t` (0 to 1 through the fill): two and a half swings that
 * die away, a nudge sideways in px, a tilt in degrees, and a slight swell.
 * Smooth all the way (one sine, damped), so it reads as a jiggle, not steps.
 */
export function wordPopWobble(t: number): { x: number; rotate: number; scale: number } {
  'worklet';
  const c = Math.min(1, Math.max(0, t));
  const damp = (1 - c) * (1 - c);
  const swing = Math.sin(c * Math.PI * 5) * damp;
  return { x: 1.6 * swing, rotate: 2.4 * swing, scale: 1 + 0.04 * Math.sin(Math.PI * c) };
}

/** The pill's scale at `t` (0 to 1 through the pop into the pill), before easing. */
export const WORD_POP_PILL_KEYS = { at: [0, 0.4, 1], scale: [WORD_POP_PILL_FROM, WORD_POP_SWELL, 1] } as const;

/** Keyframes for the wobble, for the web's animate(): `steps` + 1 frames. */
export function wordPopWobbleFrames(steps = 24): { transform: string; offset: number }[] {
  return Array.from({ length: steps + 1 }, (_, k) => {
    const t = k / steps;
    const w = wordPopWobble(t);
    return {
      transform: `translateX(${w.x.toFixed(2)}px) rotate(${w.rotate.toFixed(2)}deg) scale(${w.scale.toFixed(3)})`,
      offset: t,
    };
  });
}
