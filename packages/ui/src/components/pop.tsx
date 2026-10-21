// Hearth §8 "Pop out, pop in": a tapped suggestion leaves with a pop and the
// thing it made pops into place. `usePopOut` drives the leaving chip (swell
// at fast, swift-out, then vanish at fast, ease-in) and runs the action once
// it has gone; `PopIn` plays the arrival (from 0.94 past 1.015 to rest, fast
// then base, swift-out) each time `active` turns on. Shared values only, so
// it is safe in recycled FlashList cells: a cell that isn't arriving sits at
// rest. Reduced motion: the action runs at once and nothing scales.
// Mirrors apps/web's `.chip-pop-out` / `.row-pop-in` (globals.css).
import * as React from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  MOTION_DURATIONS_MS,
  POP_IN_FROM,
  POP_IN_PEAK,
  POP_OUT_MS,
  POP_OUT_SHRINK,
  POP_OUT_SWELL,
} from '@homeup/core';

const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.42, 0, 1, 1);

/** `start(action)` pops the view out, then runs `action`; later calls are ignored. */
export function usePopOut() {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const leaving = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const start = React.useCallback(
    (action: () => void) => {
      if (leaving.current) return;
      leaving.current = true;
      if (reduceMotion) {
        action();
        return;
      }
      const fast = MOTION_DURATIONS_MS.fast;
      scale.value = withSequence(
        withTiming(POP_OUT_SWELL, { duration: fast, easing: SWIFT_OUT }),
        withTiming(POP_OUT_SHRINK, { duration: fast, easing: EASE_IN }),
      );
      opacity.value = withDelay(fast, withTiming(0, { duration: fast, easing: EASE_IN }));
      timer.current = setTimeout(action, POP_OUT_MS);
    },
    [reduceMotion, scale, opacity],
  );

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  return { start, style };
}

interface PopInProps {
  /** Turning this on plays the arrival once. */
  active: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function PopIn({ active, className, style, children }: PopInProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  React.useEffect(() => {
    if (!active || reduceMotion) {
      scale.value = 1;
      opacity.value = 1;
      return;
    }
    scale.value = POP_IN_FROM;
    opacity.value = 0;
    scale.value = withSequence(
      withTiming(POP_IN_PEAK, { duration: MOTION_DURATIONS_MS.fast, easing: SWIFT_OUT }),
      withTiming(1, { duration: MOTION_DURATIONS_MS.base, easing: SWIFT_OUT }),
    );
    opacity.value = withTiming(1, { duration: MOTION_DURATIONS_MS.fast, easing: SWIFT_OUT });
  }, [active, reduceMotion, scale, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  return (
    <Animated.View className={className} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}

/** Ids that just arrived, each held for `holdMs` so its row can play `PopIn`. */
export function useArrivals(holdMs: number) {
  const [ids, setIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const mark = React.useCallback(
    (list: readonly string[]) => {
      if (list.length === 0) return;
      setIds((prev) => new Set([...prev, ...list]));
      setTimeout(() => {
        setIds((prev) => {
          const next = new Set(prev);
          for (const id of list) next.delete(id);
          return next;
        });
      }, holdMs);
    },
    [holdMs],
  );
  return { ids, mark };
}
