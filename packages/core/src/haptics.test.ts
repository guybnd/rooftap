import { describe, expect, it } from 'vitest';
import {
  CELEBRATE_ROLL_MS,
  HAPTIC_PATTERNS_MS,
  HOLD_CHARGE_STEPS,
  SLIDE_FINISH_AT,
  SLIDE_ZIPPER_PATTERNS_MS,
  SLIDE_ZIPPER_STEPS,
  SLIDE_ZIPPER_TIERS,
  slideZipperTier,
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
  it('clicks in rising order, all before the threshold', () => {
    expect([...SLIDE_ZIPPER_STEPS]).toEqual([...SLIDE_ZIPPER_STEPS].sort((a, b) => a - b));
    expect(SLIDE_ZIPPER_STEPS.every((s) => s > 0 && s < SLIDE_FINISH_AT)).toBe(true);
  });
  it('tightens its gaps as the thumb travels', () => {
    const gaps = SLIDE_ZIPPER_STEPS.map((s, i) => s - (i ? SLIDE_ZIPPER_STEPS[i - 1] : 0));
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1] + 1e-9);
  });
  it('firms up tier by tier and tops out at the threshold', () => {
    const tiers = SLIDE_ZIPPER_STEPS.map((_, i) => slideZipperTier(i));
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(tiers[0]).toBe(0);
    expect(tiers[tiers.length - 1]).toBe(SLIDE_ZIPPER_TIERS - 1);
    expect(slideZipperTier(SLIDE_ZIPPER_STEPS.length)).toBe(SLIDE_ZIPPER_TIERS - 1);
    expect(SLIDE_ZIPPER_PATTERNS_MS).toHaveLength(SLIDE_ZIPPER_TIERS);
  });
});
