import { describe, expect, it } from 'vitest';
import { wrapValue } from './scroll-field-math';

describe('wrapValue', () => {
  it('wraps forward past max back to min (month Dec -> Jan)', () => {
    expect(wrapValue(12, 0, 11, 1)).toBe(0);
  });

  it('wraps backward past min back to max (year loYear-1 -> hiYear)', () => {
    expect(wrapValue(2024, 2025, 2031, 1)).toBe(2031);
  });

  it('wraps a 5-minute-step field (minute -5 -> 55)', () => {
    expect(wrapValue(-5, 0, 55, 5)).toBe(55);
  });

  it('resolves a multi-step jump in one shot (HOUP-195: no more dropped steps on fast drags)', () => {
    // Dec (11) + 3 months in a single gesture frame should land on Mar (2),
    // not silently drop to Jan (1) the way the old per-unit increment loop did
    // when it kept re-reading a stale ref between synchronous iterations.
    expect(wrapValue(11 + 3 * 1, 0, 11, 1)).toBe(2);
  });

  it('is a no-op within bounds', () => {
    expect(wrapValue(15, 1, 31, 1)).toBe(15);
  });
});
