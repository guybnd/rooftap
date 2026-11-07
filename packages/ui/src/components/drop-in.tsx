// Hearth §8 "Drop in": a row just added from the item sheet arrives with a
// coral dot that falls into its leading slot, then the row pops in where it
// landed. Wrap the row and pass its id; it plays once per id (core
// takeDropIn), only while `when` holds, and never under still motion.
// Numbers come from core's touches.ts. Web twin:
// apps/web/src/components/ui/drop-in.tsx.
import * as React from 'react';
import { View, type ViewProps } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { DROP_IN_DOT, DROP_IN_DOT_MS, DROP_IN_FALL, DROP_IN_KEYS, DROP_IN_LAND_X, DROP_IN_POP_MS, takeDropIn } from '@homeup/core';
import { useStillMotion } from '../theme/theme-provider';

const AT = [...DROP_IN_KEYS.at];
const SCALE = [...DROP_IN_KEYS.scale];
const OPACITY = [...DROP_IN_KEYS.opacity];
const WHOLE = DROP_IN_DOT_MS + DROP_IN_POP_MS;
/** Where the dot lands and the pop starts, as a share of the whole. */
const LAND = DROP_IN_DOT_MS / WHOLE;

export interface DropInProps extends ViewProps {
  /** The row's id: each id drops in once. */
  id: string;
  /** The row was just added. */
  when: boolean;
}

export function DropIn({ id, when, style, children, ...props }: DropInProps) {
  const still = useStillMotion();
  const t = useSharedValue(when && !still ? 0 : 1);
  React.useEffect(() => {
    if (when && !still && takeDropIn(id)) {
      t.value = 0;
      t.value = withTiming(1, { duration: WHOLE, easing: Easing.linear });
    } else {
      t.value = 1;
    }
  }, [id, when, still, t]);
  const row = useAnimatedStyle(() => {
    const p = Math.max(0, (t.value - LAND) / (1 - LAND));
    return { opacity: interpolate(p, AT, OPACITY), transform: [{ scale: interpolate(p, AT, SCALE) }] };
  });
  const dot = useAnimatedStyle(() => {
    const f = Math.min(1, t.value / LAND);
    return {
      opacity: t.value >= LAND ? 0 : interpolate(f, [0, 0.15, 1], [0, 1, 1]),
      transform: [{ translateY: -DROP_IN_FALL * (1 - f * f) }],
    };
  });
  return (
    <View style={style} {...props}>
      <Animated.View style={row}>{children}</Animated.View>
      <Animated.View
        pointerEvents="none"
        className="bg-primary"
        style={[
          { position: 'absolute', left: DROP_IN_LAND_X - DROP_IN_DOT / 2, top: '50%', marginTop: -DROP_IN_DOT / 2, width: DROP_IN_DOT, height: DROP_IN_DOT, borderRadius: DROP_IN_DOT / 2 },
          dot,
        ]}
      />
    </View>
  );
}
