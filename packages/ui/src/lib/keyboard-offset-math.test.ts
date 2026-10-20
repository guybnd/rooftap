import { describe, expect, it } from 'vitest';
import { computeKeyboardOffset } from './keyboard-offset-math';

describe('computeKeyboardOffset', () => {
  it('is 0 when the keyboard is closed', () => {
    expect(computeKeyboardOffset(0, 34)).toBe(0);
  });

  it('nets out the safe-area bottom inset the sheet already reserves', () => {
    expect(computeKeyboardOffset(300, 34)).toBe(266);
  });

  it('clamps at 0 when the safe-area inset already covers the keyboard height', () => {
    expect(computeKeyboardOffset(20, 34)).toBe(0);
  });

  it('is a no-op with a zero safe-area inset (e.g. no home-indicator device)', () => {
    expect(computeKeyboardOffset(300, 0)).toBe(300);
  });
});
