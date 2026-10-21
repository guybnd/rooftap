/**
 * Hearth §9 (HA) — shared haptic vocabulary. Every gesture that pulses the
 * device routes through one of these instead of calling `navigator.vibrate`
 * directly, so the pattern per feeling stays consistent everywhere it fires.
 * Progressive enhancement only (Android/Chrome) — no-op elsewhere. Reduced
 * motion does NOT disable haptics; they're feedback, not animation.
 */

import { HAPTIC_PATTERNS_MS, slideZipperPulseMs } from "@homeup/core"

function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
}

/** A light detent — crossing a threshold, stepping a value. */
export function tick(): void {
  if (canVibrate()) navigator.vibrate(10)
}

/** A gesture has committed — long-press fired, a landing action opened. */
export function commit(): void {
  if (canVibrate()) navigator.vibrate(15)
}

/** Positive completion — a task finished, an action succeeded. */
export function success(): void {
  if (canVibrate()) navigator.vibrate([12, 60, 12])
}

/** A destructive or confirm-before-proceeding moment. */
export function warn(): void {
  if (canVibrate()) navigator.vibrate([10, 50, 10])
}

/** Slide to finish: one buzz of the zipper, longer as the thumb travels (core SLIDE_ZIPPER_STEPS). */
export function zipper(step: number): void {
  if (canVibrate()) navigator.vibrate(slideZipperPulseMs(step))
}

/** Slide to finish landing: a long thump and a short kick. */
export function pop(): void {
  if (canVibrate()) navigator.vibrate(HAPTIC_PATTERNS_MS.pop)
}
