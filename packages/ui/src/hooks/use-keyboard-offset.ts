// HOUP-244: native analogue of apps/web/src/hooks/use-keyboard-inset.ts. Web
// derives its overlap from the VisualViewport API; RN has no such API, so
// this composes a UI-thread shared value already driven by the OS's own
// keyboard show/hide animation, no bridge round-trip — with the caller's
// safe-area bottom inset. Pure offset math lives in ../lib/keyboard-offset-
// math.ts so it's unit-testable without pulling react-native-reanimated into
// vitest.
//
// HOUP-274: Reanimated's own `useAnimatedKeyboard` attaches its listener to
// the main Activity window only, so it never observes a keyboard raised
// inside BottomSheet's <Modal> (a separate Dialog window on Android) —
// `keyboard.height.value` stayed 0 for the Modal's whole lifetime and this
// hook was a silent no-op there. `react-native-keyboard-controller` ships a
// drop-in-compatible `useAnimatedKeyboard` (same shape: a `SharedValue`-
// backed `.height`) whose provider (`KeyboardProvider`, mounted once at the
// app root — see apps/mobile/src/app/_layout.tsx) observes the keyboard
// inside a Modal's own window too (Android Modal support since v1.13.0).
import { useAnimatedKeyboard } from 'react-native-keyboard-controller';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { computeKeyboardOffset } from '../lib/keyboard-offset-math';

/**
 * A UI-thread shared value tracking how far a bottom-anchored surface must
 * lift to clear the on-screen keyboard, net of the `safeAreaBottom` inset it
 * already reserves. Reports 0 while `enabled` is false (e.g. a caller that
 * opts out via BottomSheet's `keyboardAware={false}`).
 */
export function useKeyboardOffset(safeAreaBottom: number, enabled = true): SharedValue<number> {
  // Unlike Reanimated's version, this hook takes no per-call options — the
  // translucent-status-bar accounting BottomSheet's Modal needs (it renders
  // with `statusBarTranslucent`) is configured once on the root
  // `<KeyboardProvider statusBarTranslucent>` in _layout.tsx instead.
  const keyboard = useAnimatedKeyboard();

  return useDerivedValue(() => {
    'worklet';
    if (!enabled) return 0;
    return computeKeyboardOffset(keyboard.height.value, safeAreaBottom);
  }, [enabled, safeAreaBottom]);
}
