// Hearth §8 "Cheer burst": the coral burst from slide-to-finish around a
// thing that earned it. A ring swells off its edge and fades while sparks,
// coral and roof colours in turn, fly out and shrink, and the thing swells
// to 1.08 and back. `Cheer` wraps the thing and plays each time `play`
// goes up (0 plays nothing); `CheerGlow` lays one soft mint glow over a
// meter. Nothing moves under still motion. Numbers come from core's
// touches.ts.
// Web twin: apps/web/src/components/ui/cheer-burst.tsx.
import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { CHEER_BURST_MS, CHEER_GLOW_ALPHA, CHEER_SWELL, ROOFTAP_SPECTRUM, cheerSparks, type CheerSpark } from '@homeup/core';
import { cn } from '../lib/cn';
import { useStillMotion } from '../theme/theme-provider';

const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);

export interface CheerProps {
  /** Goes up by one each time the cheer should play; 0 plays nothing. */
  play: number;
  children: React.ReactNode;
}

/** Wraps a thing (a Hero number) so it swells and bursts when `play` goes up. */
export function Cheer({ play, children }: CheerProps) {
  const still = useStillMotion();
  const [box, setBox] = React.useState({ width: 0, height: 0 });
  const swell = useSharedValue(0);
  React.useEffect(() => {
    if (!play || still) return;
    swell.value = 0;
    swell.value = withTiming(1, { duration: CHEER_BURST_MS, easing: Easing.linear });
  }, [play, still, swell]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(swell.value, [0, 0.4, 1], [1, CHEER_SWELL, 1]) }],
  }));
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== box.width || height !== box.height) setBox({ width, height });
  };
  return (
    <View onLayout={onLayout}>
      <Animated.View style={style}>{children}</Animated.View>
      {play > 0 && !still ? <CheerBurst key={play} width={box.width} height={box.height} /> : null}
    </View>
  );
}

/** One soft mint glow over a meter when `play` goes up. Fill its parent; give it the meter's rounding. */
export function CheerGlow({ play, className }: { play: number; className?: string }) {
  const still = useStillMotion();
  const glow = useSharedValue(0);
  React.useEffect(() => {
    if (!play || still) return;
    glow.value = 0;
    glow.value = withTiming(1, { duration: CHEER_BURST_MS * 2, easing: Easing.inOut(Easing.ease) });
  }, [play, still, glow]);
  const style = useAnimatedStyle(() => ({ opacity: interpolate(glow.value, [0, 0.4, 1], [0, CHEER_GLOW_ALPHA, 0]) }));
  if (!play || still) return null;
  return (
    <Animated.View
      pointerEvents="none"
      className={cn('bg-success', className)}
      style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, style]}
    />
  );
}

export interface CheerBurstProps {
  /** The thing's box, in px. */
  width: number;
  height: number;
}

export function CheerBurst({ width, height }: CheerBurstProps) {
  const still = useStillMotion();
  const clock = useSharedValue(0);
  const sparks = React.useMemo(() => cheerSparks(width, height), [width, height]);
  React.useEffect(() => {
    if (still) return;
    clock.value = withTiming(1, { duration: CHEER_BURST_MS, easing: SWIFT_OUT });
  }, [still, clock]);
  const ring = useAnimatedStyle(() => ({
    opacity: interpolate(clock.value, [0, 0.12, 1], [0, 0.7, 0]),
    transform: [{ scale: interpolate(clock.value, [0, 1], [1, 1.3]) }],
  }));
  if (still || !width) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
      <Animated.View
        className="border-primary"
        style={[{ position: 'absolute', left: -6, top: -4, width: width + 12, height: height + 8, borderRadius: 14, borderWidth: 2 }, ring]}
      />
      <View style={{ position: 'absolute', left: width / 2, top: height / 2, width: 0, height: 0 }}>
        {sparks.map((spark, i) => (
          <Spark key={i} spark={spark} clock={clock} />
        ))}
      </View>
    </View>
  );
}

function Spark({ spark, clock }: { spark: CheerSpark; clock: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(clock.value, [0, 0.1, 0.55, 1], [0, 1, 1, 0]),
    transform: [{ translateX: spark.x * clock.value }, { translateY: spark.y * clock.value }, { scale: interpolate(clock.value, [0, 1], [1, 0.4]) }],
  }));
  return (
    <Animated.View
      className={spark.coral ? 'bg-primary' : undefined}
      style={[
        { position: 'absolute', left: -spark.size / 2, top: -spark.size / 2, width: spark.size, height: spark.size, borderRadius: spark.size / 2 },
        spark.coral ? null : { backgroundColor: ROOFTAP_SPECTRUM[spark.hue] },
        style,
      ]}
    />
  );
}
