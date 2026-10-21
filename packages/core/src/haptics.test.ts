import { describe, expect, it } from 'vitest';
import {
  CELEBRATE_ROLL_MS,
  HAPTIC_PATTERNS_MS,
  HOLD_CHARGE_STEPS,
  SLIDE_FINISH_AT,
  SLIDE_ZIPPER_STEPS,
  slideZipperPulseMs,
  slideZipperStrength,
  stepsCrossed,
} from './tokens';

describe('stepsCrossed', () => {
  it('reports each step passed going up', () => {
    expect(stepsCrossed([0.25, 0.5, 0.75], 0, 0.3)).toEqual([0]);
    expect(stepsCrossed([0.25, 0.5, 0.75], 0.3, 0.8)).toEqual([1, 2]);
  });
  it('fires a step exactly once when landing on it', () => {
    expect(stepsCrossed(HOLD_CHARGE_STEPS, 0.2, 0.4)).toEqual([0]);
    expect(stepsCrossed(HOLD_CHARGE_STEPS, 0.4, 0.5)).toEqual([]);
  });
  it('never fires going down or standing still', () => {
    expect(stepsCrossed([0.25, 0.5], 0.9, 0.1)).toEqual([]);
    expect(stepsCrossed([0.25, 0.5], 0.5, 0.5)).toEqual([]);
  });
});

describe('haptic vocabulary', () => {
  it('gives every pulse a pattern of positive durations', () => {
    for (const pattern of Object.values(HAPTIC_PATTERNS_MS)) {
      expect(pattern.length % 2).toBe(1);
      expect(pattern.every((ms) => ms > 0)).toBe(true);
    }
  });
  it('rolls the celebration in rising order', () => {
    expect([...CELEBRATE_ROLL_MS]).toEqual([...CELEBRATE_ROLL_MS].sort((a, b) => a - b));
  });
});

describe('slide zipper', () => {
  it('buzzes in rising order, all before the threshold', () => {
    expect([...SLIDE_ZIPPER_STEPS]).toEqual([...SLIDE_ZIPPER_STEPS].sort((a, b) => a - b));
    expect(SLIDE_ZIPPER_STEPS.every((s) => s > 0 && s < SLIDE_FINISH_AT)).toBe(true);
    expect(SLIDE_ZIPPER_STEPS.length).toBeGreaterThanOrEqual(24);
  });
  it('tightens its gaps as the thumb travels', () => {
    const gaps = SLIDE_ZIPPER_STEPS.map((s, i) => s - (i ? SLIDE_ZIPPER_STEPS[i - 1] : 0));
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1] + 1e-3);
    expect(gaps[gaps.length - 1]).toBeLessThan(gaps[0] / 3);
  });
  it('grows each pulse and tops out at the threshold', () => {
    const pulses = SLIDE_ZIPPER_STEPS.map((_, i) => slideZipperPulseMs(i));
    expect(pulses).toEqual([...pulses].sort((a, b) => a - b));
    expect(pulses[0]).toBeLessThan(10);
    expect(slideZipperPulseMs(SLIDE_ZIPPER_STEPS.length)).toBe(40);
    expect(slideZipperStrength(SLIDE_ZIPPER_STEPS.length + 3)).toBe(1);
  });
});
