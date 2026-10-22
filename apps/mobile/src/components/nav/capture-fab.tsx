// HOUP-68: native port of apps/web/src/components/capture/capture-buttons.tsx's
// `MobileCaptureFab` (Hearth M1: "the tab bar's raised capture '+' anchors the
// thumb zone"). A tap opens the capture sheet. With `onAsk` (assistant on),
// the + is also the way into the pop-up chat (features/assistant/chat-popup.tsx):
// swipe up from it, or hold it and the slide's zipper ramps up under the
// thumb into the pop that opens the chat. Web twin: MobileCaptureFab.
import * as React from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { ASK_HOLD_MS, askHoldZipperMs, sectionHueSwatch } from '@homeup/core';
import { cn, haptics, useThemeMaterial, useStillMotion } from '@homeup/ui';
import { RooftapMark } from '@/components/brand/rooftap-mark';

/** How far up a swipe must travel (or how fast) to open the chat. */
const SWIPE_OPEN_PX = 40;
const SWIPE_OPEN_VELOCITY = -500;
/** The + follows a swipe at this fraction of the finger, up to this far. */
const SWIPE_FOLLOW = 0.6;
const SWIPE_MAX_LIFT = 36;

export interface CaptureFabProps {
  onPress?: () => void;
  /** A reply waiting unread: the + wears a small dot in the assistant's glow. */
  unread?: boolean;
  /** Opens the chat on a hold or a swipe up; leave out to make the + tap-only. */
  onAsk?: () => void;
  className?: string;
}

export function CaptureFab({ onPress, onAsk, unread, className }: CaptureFabProps) {
  const { scheme, still: flat } = useThemeMaterial();
  const still = useStillMotion();
  const hue = sectionHueSwatch('assistant', scheme);
  const lift = useSharedValue(0);
  const charge = useSharedValue(0);
  const armed = useSharedValue(false);

  // Gesture callbacks read the latest props through refs, so the gesture
  // isn't rebuilt on every tab bar render.
  const pressRef = React.useRef(onPress);
  const askRef = React.useRef(onAsk);
  React.useEffect(() => {
    pressRef.current = onPress;
    askRef.current = onAsk;
  }, [onPress, onAsk]);
  const canAsk = !!onAsk;

  const ramp = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const stopRamp = React.useCallback(() => {
    ramp.current.forEach(clearTimeout);
    ramp.current = [];
  }, []);
  const startRamp = React.useCallback(() => {
    stopRamp();
    ramp.current = askHoldZipperMs().map((ms, step) => setTimeout(() => haptics.zipper(step), ms));
  }, [stopRamp]);
  React.useEffect(() => stopRamp, [stopRamp]);

  const press = React.useCallback(() => pressRef.current?.(), []);
  const holdOpen = React.useCallback(() => {
    stopRamp();
    haptics.pop();
    askRef.current?.();
  }, [stopRamp]);
  const swipeOpen = React.useCallback(() => {
    stopRamp();
    haptics.commit();
    askRef.current?.();
  }, [stopRamp]);
  const tick = React.useCallback(() => haptics.tick(), []);

  const gesture = React.useMemo(() => {
    const tap = Gesture.Tap()
      .maxDuration(ASK_HOLD_MS)
      .onEnd((_event, success) => {
        'worklet';
        if (success) runOnJS(press)();
      });
    if (!canAsk) return tap;
    const hold = Gesture.LongPress()
      .minDuration(ASK_HOLD_MS)
      .onBegin(() => {
        'worklet';
        charge.value = withTiming(1, { duration: ASK_HOLD_MS });
        runOnJS(startRamp)();
      })
      .onStart(() => {
        'worklet';
        runOnJS(holdOpen)();
      })
      .onFinalize(() => {
        'worklet';
        charge.value = withTiming(0, { duration: 150 });
        runOnJS(stopRamp)();
      });
    const swipe = Gesture.Pan()
      .activeOffsetY(-12)
      .failOffsetX([-24, 24])
      .onUpdate((event) => {
        'worklet';
        lift.value = Math.max(-SWIPE_MAX_LIFT, Math.min(0, event.translationY * SWIPE_FOLLOW));
        const past = event.translationY < -SWIPE_OPEN_PX;
        if (past !== armed.value) {
          armed.value = past;
          if (past) runOnJS(tick)();
        }
      })
      .onEnd((event) => {
        'worklet';
        if (event.translationY < -SWIPE_OPEN_PX || event.velocityY < SWIPE_OPEN_VELOCITY) runOnJS(swipeOpen)();
      })
      .onFinalize(() => {
        'worklet';
        armed.value = false;
        lift.value = withSpring(0, { damping: 18, stiffness: 260 });
      });
    return Gesture.Race(swipe, hold, tap);
  }, [canAsk, press, startRamp, stopRamp, holdOpen, swipeOpen, tick, charge, lift, armed]);

  const fabStyle = useAnimatedStyle(() => ({
    transform: still ? [] : [{ translateY: lift.value }, { scale: 1 + 0.14 * charge.value - lift.value / 400 }],
  }));
  // The assistant's glow gathers round the + as the hold charges or the swipe climbs.
  const glowStyle = useAnimatedStyle(() => {
    const p = Math.max(charge.value, -lift.value / SWIPE_MAX_LIFT);
    return { opacity: 0.85 * p, transform: [{ scale: 1 + 0.45 * p }] };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={unread ? 'Add, new answer waiting' : 'Add'}
        accessibilityHint={onAsk ? 'Hold or swipe up to chat with Rooftap' : undefined}
        accessibilityActions={onAsk ? [{ name: 'activate' }, { name: 'longpress', label: 'Chat with Rooftap' }] : [{ name: 'activate' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate') onPress?.();
          else if (e.nativeEvent.actionName === 'longpress') onAsk?.();
        }}
        style={fabStyle}
        className={cn('absolute -top-5 left-1/2 z-30 -ml-6 h-12 w-12 items-center justify-center', className)}
      >
        {onAsk && (
          <Animated.View
            pointerEvents="none"
            className="absolute inset-0 rounded-full"
            style={[{ backgroundColor: hue.glow }, glowStyle]}
          />
        )}
        <View className={cn('h-12 w-12 items-center justify-center rounded-full bg-primary', !flat && 'shadow-lg')}>
          <RooftapMark size={26} className="text-primary-foreground" />
        </View>
        {unread && (
          <View
            pointerEvents="none"
            className="absolute right-0 top-0 size-3.5 rounded-full border-2 border-background"
            style={{ backgroundColor: hue.glow }}
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
}
