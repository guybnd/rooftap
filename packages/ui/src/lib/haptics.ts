// HOUP-68 (Hearth §9, HA) — base/web impl. Metro resolves `haptics.native.ts`
// instead for apps/mobile (ios/android); webpack/Next never sees that file,
// so `expo-haptics` never enters a web bundle. Mirrors
// apps/web/src/lib/haptics.ts's `navigator.vibrate` pattern, but sourced from
// @homeup/core's HAPTIC_PATTERNS_MS instead of re-hardcoding the ms values.
import { HAPTIC_PATTERNS_MS, SLIDE_ZIPPER_PATTERNS_MS, slideZipperTier, type HapticPulse } from '@homeup/core';

let enabled = true;

/** The device-local Haptics switch in Settings; off silences every pulse below. */
export function setHapticsEnabled(next: boolean): void {
  enabled = next;
}

export function hapticsEnabled(): boolean {
  return enabled;
}

function canVibrate(): boolean {
  return enabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function fire(pulse: HapticPulse): void {
  if (canVibrate()) navigator.vibrate(HAPTIC_PATTERNS_MS[pulse]);
}

/** A choice changed — a toggle flipped, a segment or chip picked. The lightest pulse. */
export const select = () => fire('select');
/** A light detent — crossing a threshold, stepping a value. */
export const tick = () => fire('tick');
/** A gesture has committed — long-press fired, a landing action opened. */
export const commit = () => fire('commit');
/** Positive completion — a task finished, an action succeeded. */
export const success = () => fire('success');
/** A destructive or confirm-before-proceeding moment. */
export const warn = () => fire('warn');
/** Something failed — a save that didn't land, an action that was refused. */
export const error = () => fire('error');
/** A thing is gone — the delete itself, after any confirm. */
export const remove = () => fire('remove');
/** A big finish — a list cleared, a checklist at 100%. */
export const celebrate = () => fire('celebrate');
/** Hold to edit: one step of the rising charge (a vibration motor can't grade it, so each is a select). */
export const charge = (_step: number) => fire('select');
/** Slide to finish: one click of the zipper, longer each third (a motor can't grade strength). */
export const zipper = (step: number) => {
  if (canVibrate()) navigator.vibrate([...SLIDE_ZIPPER_PATTERNS_MS[slideZipperTier(step)]]);
};
/** Slide to finish landing: one firm hit and a short echo. */
export const pop = () => fire('pop');
