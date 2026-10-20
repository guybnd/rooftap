// HOUP-68: native port of apps/web/src/components/ui/use-pressable.ts. The
// web hook hand-rolls pointer-event tracking (move-slop cancel, long-press
// timer, synthetic-click suppression) because the browser gives no gesture
// primitive of its own; on native, react-native-gesture-handler already
// solves arbitration (exclusive tap-vs-long-press, distance-based cancel) —
// this hook is a thin, Reanimated-driven wrapper over `Gesture.Exclusive`
// that mirrors the web hook's *behavioral* contract (pressed/longPressing
// state, onPress vs. onLongPress mutual exclusivity, a commit() haptic on
// long-press) rather than its pointer-event plumbing, which has no native
// equivalent to port.
import { useCallback, useState } from 'react';
import type { ViewStyle } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { commit } from '../lib/haptics';

export interface UsePressableOptions {
  /** Fires on a completed press that did not escalate into a long-press. */
  onPress?: () => void;
  /** Fires once the pointer has been held for `longPressMs`. Omit to disable long-press entirely. */
  onLongPress?: () => void;
  /** Hold duration before `onLongPress` fires. */
  longPressMs?: number;
  disabled?: boolean;
  /** Fire a `commit()` haptic when the long-press activates. */
  haptics?: boolean;
}

export interface UsePressableResult {
  pressed: boolean;
  longPressing: boolean;
  /** Compose with `GestureDetector`. */
  gesture: ReturnType<typeof Gesture.Exclusive>;
  /** Spread onto the wrapped `Animated.View`'s `style` — the press-scale feedback (mirrors `PRESSABLE_SCALE_CLASSNAME`). */
  animatedStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
}

/** Movement tolerance before an active press/long-press is cancelled — mirrors the web hook's tap-slop constant. */
const MOVE_SLOP_PX = 10;
const PRESS_SCALE = 0.97;
const SCALE_DURATION_MS = 150;

export function usePressable(options: UsePressableOptions = {}): UsePressableResult {
  const { onPress, onLongPress, longPressMs = 500, disabled = false, haptics = true } = options;

  const [pressed, setPressed] = useState(false);
  const [longPressing, setLongPressing] = useState(false);
  const scale = useSharedValue(1);

  const firePress = useCallback(() => onPress?.(), [onPress]);
  const fireLongPress = useCallback(() => {
    if (haptics) commit();
    onLongPress?.();
  }, [haptics, onLongPress]);

  const tap = Gesture.Tap()
    .enabled(!disabled)
    .maxDistance(MOVE_SLOP_PX)
    .onBegin(() => {
      'worklet';
      scale.value = withTiming(PRESS_SCALE, { duration: SCALE_DURATION_MS });
      runOnJS(setPressed)(true);
    })
    .onFinalize(() => {
      'worklet';
      scale.value = withTiming(1, { duration: SCALE_DURATION_MS });
      runOnJS(setPressed)(false);
    })
    .onEnd((_event, success) => {
      'worklet';
      if (success) runOnJS(firePress)();
    });

  // Given priority via Gesture.Exclusive below: while it's still resolving
  // (within longPressMs), the tap cannot activate — mirrors the web hook's
  // "long-press escalation suppresses the trailing click" contract.
  const longPress = Gesture.LongPress()
    .enabled(!disabled && Boolean(onLongPress))
    .minDuration(longPressMs)
    .maxDistance(MOVE_SLOP_PX)
    .onStart(() => {
      'worklet';
      runOnJS(setLongPressing)(true);
      runOnJS(fireLongPress)();
    })
    .onFinalize(() => {
      'worklet';
      runOnJS(setLongPressing)(false);
    });

  const gesture = Gesture.Exclusive(longPress, tap);
  const animatedStyle = useAnimatedStyle<ViewStyle>(() => ({ transform: [{ scale: scale.value }] }));

  return { pressed, longPressing, gesture, animatedStyle };
}
