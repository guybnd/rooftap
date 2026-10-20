import { describe, expect, it } from 'vitest';
import { CELEBRATE_ROLL_MS, HAPTIC_PATTERNS_MS, HOLD_CHARGE_STEPS, stepsCrossed } from './tokens';

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
