// Hearth v2 (Pulse): slide-to-finish, the Now card's M3 gesture. Drag the
// coral thumb to the end of the track to finish the item; let go short of
// the end and it springs back. The thumb zips as it travels (a click at each
// quarter, each firmer), a tick() marks the threshold and success() lands
// the finish (HA). Screen readers get a plain "Finish" action, and the
// card around it keeps tap = open (M3 always has a tap path).
//
// Finishing celebrates once: as the thumb lands its check pops and a small
// coral burst (a ring and a few sparks) leaves it, over slow. One shot,
// transform and opacity only (MO), and none of it under reduced motion,
// where the check simply shows. The haptic is the same success() either way.
import * as React from 'react';
import { Text, View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { ArrowRight, Check } from 'lucide-react-native';
import { MOTION_DURATIONS_MS, SLIDE_ZIPPER_STEPS } from '@homeup/core';
import { cn } from '../lib/cn';
import { success, tick, zipper } from '../lib/haptics';

const THUMB = 48;
const INSET = 4;
const TRACK = 56;
/** Fraction of the travel past which a release finishes the item. */
const FINISH_AT = 0.82;
const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);
/** Sparks around the landed thumb: angle (deg) and size (px), alternating so the burst doesn't read as a stamp. */
const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => ({ deg: deg + 22.5, size: i % 2 ? 5 : 7 }));
const SPARK_FROM = THUMB / 2 - 2;
const SPARK_TO = THUMB / 2 + 26;
const ZIPPER_AT = [...SLIDE_ZIPPER_STEPS];

export interface SlideToCompleteProps extends ViewProps {
  onComplete: () => void;
  /** Track text. */
  label?: string;
  disabled?: boolean;
}

export function SlideToComplete({ onComplete, label = 'Slide to finish', disabled, className, ...props }: SlideToCompleteProps) {
  const reduceMotion = useReducedMotion();
  const [trackWidth, setTrackWidth] = React.useState(0);
  const [finished, setFinished] = React.useState(false);
  const offset = useSharedValue(0);
  const armed = useSharedValue(0);
  /** Furthest zipper step clicked this drag, so dragging back and forth over one doesn't chatter. */
  const zipped = useSharedValue(-1);
  const pop = useSharedValue(1);
  const burst = useSharedValue(0);
  const travel = Math.max(0, trackWidth - THUMB - INSET * 2);

  const fireTick = React.useCallback(() => tick(), []);
  const fireZip = React.useCallback((step: number) => zipper(step), []);
  const finish = React.useCallback(() => {
    setFinished(true);
    success();
    if (!reduceMotion) {
      // The thumb lands at fast; the check pops and the burst leaves it as it does.
      pop.value = withDelay(
        MOTION_DURATIONS_MS.fast,
        withSequence(
          withTiming(1.16, { duration: MOTION_DURATIONS_MS.fast, easing: SWIFT_OUT }),
          withTiming(1, { duration: MOTION_DURATIONS_MS.base, easing: SWIFT_OUT })
        )
      );
      burst.value = withDelay(MOTION_DURATIONS_MS.fast, withTiming(1, { duration: MOTION_DURATIONS_MS.slow, easing: SWIFT_OUT }));
    }
    onComplete();
  }, [onComplete, reduceMotion, pop, burst]);

  const pan = Gesture.Pan()
    .enabled(!disabled && !finished && travel > 0)
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onUpdate((event) => {
      'worklet';
      const next = Math.max(0, Math.min(travel, event.translationX));
      offset.value = next;
      for (let i = zipped.value + 1; i < ZIPPER_AT.length; i++) {
        if (next < travel * ZIPPER_AT[i]) break;
        zipped.value = i;
        runOnJS(fireZip)(i);
      }
      const past = next >= travel * FINISH_AT ? 1 : 0;
      if (past !== armed.value) {
        armed.value = past;
        if (past) runOnJS(fireTick)();
      }
    })
    .onEnd(() => {
      'worklet';
      if (offset.value >= travel * FINISH_AT) {
        offset.value = withTiming(travel, { duration: MOTION_DURATIONS_MS.fast });
        runOnJS(finish)();
      } else {
        offset.value = withTiming(0, { duration: MOTION_DURATIONS_MS.base });
      }
      armed.value = 0;
      zipped.value = -1;
    });

  // The screen-reader path finishes without a drag: land the thumb too.
  const finishFromAction = () => {
    offset.value = withTiming(travel, { duration: MOTION_DURATIONS_MS.fast });
    finish();
  };

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }, { scale: pop.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: offset.value + THUMB + INSET }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: travel > 0 ? interpolate(offset.value, [0, travel * 0.5], [1, 0], 'clamp') : 1,
  }));

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View className={cn('relative', className)} {...props}>
      <View
        onLayout={onLayout}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled || finished }}
        accessibilityActions={[{ name: 'activate', label: 'Finish' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate' && !disabled && !finished) finishFromAction();
        }}
        className={cn('relative h-14 justify-center overflow-hidden rounded-full bg-muted', disabled && 'opacity-50')}
      >
        <Animated.View style={fillStyle} className="absolute bottom-0 left-0 top-0 rounded-full bg-primary/15" />
        <Animated.View style={labelStyle} className="absolute inset-0 items-center justify-center pl-10">
          <Text className="text-body font-semibold text-muted-foreground">{finished ? 'Done' : label}</Text>
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[{ width: THUMB, height: THUMB, marginLeft: INSET }, thumbStyle]}
            className="items-center justify-center rounded-full bg-primary"
          >
            {finished ? (
              <Check size={22} className="text-primary-foreground" strokeWidth={2.6} />
            ) : (
              <ArrowRight size={22} className="text-primary-foreground" strokeWidth={2.4} />
            )}
          </Animated.View>
        </GestureDetector>
      </View>
      {/* Outside the track so its rounded clip doesn't cut the burst off;
          centred where the thumb lands. */}
      {finished && !reduceMotion && trackWidth > 0 && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: trackWidth - INSET - THUMB / 2, top: TRACK / 2, width: 0, height: 0 }}
        >
          <BurstRing progress={burst} />
          {SPARKS.map((spark) => (
            <BurstSpark key={spark.deg} progress={burst} deg={spark.deg} size={spark.size} />
          ))}
        </View>
      )}
    </View>
  );
}

/** A thin coral ring that swells off the thumb's edge and fades. */
function BurstRing({ progress }: { progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 1], [0, 0.7, 0]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 1.7]) }],
  }));
  return (
    <Animated.View
      style={[{ position: 'absolute', left: -THUMB / 2, top: -THUMB / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 2 }, style]}
      className="border-primary"
    />
  );
}

/** One spark: leaves the thumb's edge along `deg`, shrinking and fading as it goes. */
function BurstSpark({ progress, deg, size }: { progress: SharedValue<number>; deg: number; size: number }) {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const style = useAnimatedStyle(() => {
    const r = interpolate(progress.value, [0, 1], [SPARK_FROM, SPARK_TO]);
    return {
      opacity: interpolate(progress.value, [0, 0.1, 0.55, 1], [0, 1, 1, 0]),
      transform: [{ translateX: dx * r }, { translateY: dy * r }, { scale: interpolate(progress.value, [0, 1], [1, 0.4]) }],
    };
  });
  return (
    <Animated.View
      style={[{ position: 'absolute', left: -size / 2, top: -size / 2, width: size, height: size, borderRadius: size / 2 }, style]}
      className="bg-primary"
    />
  );
}
