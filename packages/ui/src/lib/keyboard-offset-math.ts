// HOUP-244: pure offset math for use-keyboard-offset.ts, split out so it's
// testable without pulling react-native-reanimated into vitest (mirrors the
// scroll-field-math.ts convention).

/**
 * How far a bottom-anchored sheet must lift to clear the on-screen keyboard,
 * given the keyboard's reported height and the safe-area bottom inset the
 * sheet already reserves as padding. The sheet's resting position already
 * sits `safeAreaBottom` above the physical screen edge, so only the portion
 * of the keyboard taller than that already-reserved gap needs to be offset —
 * the native analogue of web's useKeyboardInset overlap calc
 * (innerHeight - vv.height - vv.offsetTop).
 */
export function computeKeyboardOffset(keyboardHeight: number, safeAreaBottom: number): number {
  'worklet';
  return Math.max(0, keyboardHeight - safeAreaBottom);
}
