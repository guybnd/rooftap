// HOUP-68 (Hearth §9, HA) — native impl (Metro's `.native.ts` platform
// resolution picks this over haptics.ts for ios/android). Maps each named
// haptic *moment* (not the web's raw vibration-pattern ms) to Expo's nearest
// feedback style — see @homeup/core's HAPTIC_PATTERNS_MS doc comment: "RN's
// haptic engine ... maps its own feedback styles to these same named moments."
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { CELEBRATE_ROLL_MS, slideZipperTier } from '@homeup/core';

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

/**
 * Android's system haptic primitives (View.performHapticFeedback): short,
 * crisp, tuned per phone. Expo's impactAsync on Android is a 43-60ms buzz at
 * a fifth of full strength, too soft and too long to ramp with, so the
 * effects that need a felt climb use these. They follow the phone's own
 * Touch feedback setting as well as ours.
 */
function android(type: Haptics.AndroidHaptics): void {
  if (enabled) void Haptics.performAndroidHapticsAsync(type).catch(() => {});
}

// Climbing strength per zipper tier (core slideZipperTier): texture tick, tick, click.
const ZIPPER_ANDROID = [Haptics.AndroidHaptics.Clock_Tick, Haptics.AndroidHaptics.Context_Click, Haptics.AndroidHaptics.Virtual_Key];
const ZIPPER_IOS = [Haptics.ImpactFeedbackStyle.Soft, Haptics.ImpactFeedbackStyle.Light, Haptics.ImpactFeedbackStyle.Medium];
/**
 * Slide to finish: one click of the zipper as the thumb travels (core
 * SLIDE_ZIPPER_STEPS, tightening as it goes). Each third clicks firmer; the
 * step past the last is the threshold and clicks at the top tier.
 */
export function zipper(step: number): void {
  const tier = slideZipperTier(step);
  if (Platform.OS === 'android') android(ZIPPER_ANDROID[tier]);
  else impact(ZIPPER_IOS[tier]);
}

/** Pop's echo lands as the visual pop settles back, after the heavy hit. */
const POP_ECHO_MS = 90;
/** Slide to finish landing: the zipper's payoff. One heavy hit, then a lighter echo as the check settles. */
export function pop(): void {
  if (!enabled) return;
  if (Platform.OS === 'android') {
    android(Haptics.AndroidHaptics.Long_Press);
    setTimeout(() => android(Haptics.AndroidHaptics.Virtual_Key), POP_ECHO_MS);
  } else {
    impact(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => impact(Haptics.ImpactFeedbackStyle.Light), POP_ECHO_MS);
  }
}

const ROLL = [Haptics.ImpactFeedbackStyle.Light, Haptics.ImpactFeedbackStyle.Medium, Haptics.ImpactFeedbackStyle.Heavy];
/** A big finish — a list cleared, a checklist at 100%. A rising roll that lands on success(). */
export function celebrate(): void {
  if (!enabled) return;
  ROLL.forEach((style, i) => setTimeout(() => impact(style), CELEBRATE_ROLL_MS[i]));
  setTimeout(success, CELEBRATE_ROLL_MS[ROLL.length]);
}
