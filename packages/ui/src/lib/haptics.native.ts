// HOUP-68 (Hearth §9, HA) — native impl (Metro's `.native.ts` platform
// resolution picks this over haptics.ts for ios/android). Maps each named
// haptic *moment* (not the web's raw vibration-pattern ms) to Expo's nearest
// feedback style — see @homeup/core's HAPTIC_PATTERNS_MS doc comment: "RN's
// haptic engine ... maps its own feedback styles to these same named moments."
import * as Haptics from 'expo-haptics';
import { CELEBRATE_ROLL_MS } from '@homeup/core';

let enabled = true;

/** The device-local Haptics switch in Settings; off silences every pulse below. */
export function setHapticsEnabled(next: boolean): void {
  enabled = next;
}

export function hapticsEnabled(): boolean {
  return enabled;
}

function impact(style: Haptics.ImpactFeedbackStyle): void {
  if (enabled) void Haptics.impactAsync(style).catch(() => {});
}

function notify(type: Haptics.NotificationFeedbackType): void {
  if (enabled) void Haptics.notificationAsync(type).catch(() => {});
}

/** A choice changed — a toggle flipped, a segment or chip picked. The lightest pulse. */
export function select(): void {
  if (enabled) void Haptics.selectionAsync().catch(() => {});
}

/** A light detent — crossing a threshold, stepping a value. */
export function tick(): void {
  impact(Haptics.ImpactFeedbackStyle.Light);
}

/** A gesture has committed — long-press fired, a landing action opened. */
export function commit(): void {
  impact(Haptics.ImpactFeedbackStyle.Medium);
}

/** Positive completion — a task finished, an action succeeded. */
export function success(): void {
  notify(Haptics.NotificationFeedbackType.Success);
}

/** A destructive or confirm-before-proceeding moment. */
export function warn(): void {
  notify(Haptics.NotificationFeedbackType.Warning);
}

/** Something failed — a save that didn't land, an action that was refused. */
export function error(): void {
  notify(Haptics.NotificationFeedbackType.Error);
}

/** A thing is gone — the delete itself, after any confirm. A short rigid knock. */
export function remove(): void {
  impact(Haptics.ImpactFeedbackStyle.Rigid);
}

const CHARGE = [Haptics.ImpactFeedbackStyle.Soft, Haptics.ImpactFeedbackStyle.Light];
/** Hold to edit: one step of the rising charge while the fill sweeps (core HOLD_CHARGE_STEPS). */
export function charge(step: number): void {
  impact(CHARGE[Math.min(step, CHARGE.length - 1)]);
}

const ZIPPER = [Haptics.ImpactFeedbackStyle.Soft, Haptics.ImpactFeedbackStyle.Light, Haptics.ImpactFeedbackStyle.Medium];
/** Slide to finish: one click of the zipper as the thumb travels (core SLIDE_ZIPPER_STEPS). */
export function zipper(step: number): void {
  impact(ZIPPER[Math.min(step, ZIPPER.length - 1)]);
}

const ROLL = [Haptics.ImpactFeedbackStyle.Light, Haptics.ImpactFeedbackStyle.Medium, Haptics.ImpactFeedbackStyle.Heavy];
/** A big finish — a list cleared, a checklist at 100%. A rising roll that lands on success(). */
export function celebrate(): void {
  if (!enabled) return;
  ROLL.forEach((style, i) => setTimeout(() => impact(style), CELEBRATE_ROLL_MS[i]));
  setTimeout(success, CELEBRATE_ROLL_MS[ROLL.length]);
}
