// Hearth §8 "Hop": a small squash and hop when something is done in one tap
// (the bins going out). Wrap the thing; it hops each time `when` turns true,
// never on mount, and holds still under reduced motion. Keys from core's
// touches.ts. Web twin: apps/web/src/components/ui/hop.tsx.
import * as React from 'react';
import type { ViewProps } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { HOP_KEYS, HOP_MS } from '@homeup/core';
import { useStillMotion } from '../theme/theme-provider';

const AT = [...HOP_KEYS.at];
const Y = [...HOP_KEYS.y];
const SX = [...HOP_KEYS.scaleX];
const SY = [...HOP_KEYS.scaleY];

export interface HopProps extends ViewProps {
  /** Hops each time this turns true. */
  when: boolean;
}

export function Hop({ when, style, ...props }: HopProps) {
  const still = useStillMotion();
  const t = useSharedValue(1);
  const was = React.useRef(when);
  React.useEffect(() => {
    if (when && !was.current && !still) {
      t.value = 0;
      t.value = withTiming(1, { duration: HOP_MS, easing: Easing.linear });
    }
    was.current = when;
  }, [when, still, t]);
  const hop = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(t.value, AT, Y) },
      { scaleX: interpolate(t.value, AT, SX) },
      { scaleY: interpolate(t.value, AT, SY) },
    ],
  }));
  return <Animated.View style={[{ transformOrigin: 'bottom' }, style, hop]} {...props} />;
}
