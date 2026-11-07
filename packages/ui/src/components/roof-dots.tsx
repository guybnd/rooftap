// Hearth §8 "Roof dots": six dots fly out of a thing's centre into the
// Rooftap roof over it, hold, then drift up and fade. One shot. Place it as
// the last child of the thing (it centres itself there); it draws nothing
// under still motion. Geometry and timing come from core's touches.ts.
// Web twin: apps/web/src/components/ui/roof-dots.tsx.
import * as React from 'react';
import { View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { motionEaseOut, ROOF_DOTS_DRIFT, ROOF_DOTS_FLY, ROOF_DOTS_MS, ROOFTAP_SPECTRUM, roofDots, type RoofDot } from '@homeup/core';
import { useStillMotion } from '../theme/theme-provider';

export interface RoofDotsProps {
  /** The thing's box, in px. */
  width: number;
  height: number;
  /** Wait this long before the dots leave, in ms. */
  delay?: number;
  /** One colour for every dot, as a class (`bg-primary-foreground` on a coral ground); the icon's spectrum otherwise. */
  dotClassName?: string;
}

export function RoofDots({ width, height, delay = 0, dotClassName }: RoofDotsProps) {
  const still = useStillMotion();
  const clock = useSharedValue(0);
  const dots = React.useMemo(() => roofDots(width, height), [width, height]);
  React.useEffect(() => {
    if (still) return;
    clock.value = withDelay(delay, withTiming(1, { duration: ROOF_DOTS_MS, easing: Easing.linear }));
  }, [still, delay, clock]);
  if (still) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: width / 2, top: height / 2, width: 0, height: 0 }}>
      {dots.map((dot, i) => (
        <Dot key={i} dot={dot} color={dotClassName ? undefined : ROOFTAP_SPECTRUM[i]} className={dotClassName} clock={clock} />
      ))}
    </View>
  );
}

function Dot({ dot, color, className, clock }: { dot: RoofDot; color?: string; className?: string; clock: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const t = clock.value;
    const fly = motionEaseOut(Math.min(1, t / ROOF_DOTS_FLY));
    const rest = Math.max(0, (t - ROOF_DOTS_FLY) / (1 - ROOF_DOTS_FLY));
    return {
      opacity: interpolate(t, [0, 0.05, ROOF_DOTS_FLY, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: dot.x * fly },
        { translateY: dot.y * fly - ROOF_DOTS_DRIFT * rest },
        { scale: interpolate(t, [0, ROOF_DOTS_FLY, 1], [0.6, 1, 0.5]) },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: -dot.size / 2, top: -dot.size / 2, width: dot.size, height: dot.size, borderRadius: dot.size / 2 },
        color ? { backgroundColor: color } : null,
        style,
      ]}
      className={className}
    />
  );
}
