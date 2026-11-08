// HOUP-68: native port of apps/web/src/components/capture/capture-buttons.tsx's
// `MobileCaptureFab` (Hearth M1: "the tab bar's raised capture '+' anchors the
// thumb zone"). A tap opens the capture sheet. With `onAsk` (assistant on),
// the + is also the way into the pop-up chat (features/assistant/chat-popup.tsx):
// swipe up from it, or hold it and the slide's zipper ramps up under the
// thumb into the pop that opens the chat. With module helpers on (`choices`),
// the hold grows a short list of chats instead (core holdChoices): the helper
// for this screen first, Ask Rooftap next to the +; slide up to one and let
// go. Web twin: MobileCaptureFab.
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
import { ASK_HOLD_MS, askHoldZipperMs, holdChoiceAt, sectionHueSwatch, type ChatChoice } from '@homeup/core';
import { LeadingTile, Text, cn, haptics, useThemeMaterial, useStillMotion } from '@homeup/ui';
import { RooftapMark, RooftapTile } from '@/components/brand/rooftap-mark';
import { SpectrumOutline } from '@/components/brand/spectrum-outline';
import { sectionIconFor } from '@/lib/section-icons';

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
  /** The chats a hold can open (core holdChoices); with more than one the hold shows them to pick from. */
  choices?: ChatChoice[];
  onChoose?: (choice: ChatChoice) => void;
  className?: string;
}

export function CaptureFab({ onPress, onAsk, unread, choices, onChoose, className }: CaptureFabProps) {
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
  const chooseRef = React.useRef(onChoose);
  const choicesRef = React.useRef(choices ?? []);
  React.useEffect(() => {
    pressRef.current = onPress;
    askRef.current = onAsk;
    chooseRef.current = onChoose;
    choicesRef.current = choices ?? [];
  }, [onPress, onAsk, onChoose, choices]);
  const canAsk = !!onAsk;
  const fanned = canAsk && (choices?.length ?? 0) > 1;
  // The hold's list while it is up, and the row under the finger.
  const [fan, setFan] = React.useState(false);
  const [pick, setPick] = React.useState(0);
  const pickRef = React.useRef(0);

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
  const showFan = React.useCallback(() => {
    stopRamp();
    haptics.pop();
    const last = Math.max(0, choicesRef.current.length - 1);
    pickRef.current = last;
    setPick(last);
    setFan(true);
  }, [stopRamp]);
  const moveFan = React.useCallback((dy: number) => {
    const at = holdChoiceAt(dy, choicesRef.current.length);
    if (at === pickRef.current) return;
    pickRef.current = at;
    setPick(at);
    haptics.tick();
  }, []);
  const chooseFan = React.useCallback(() => {
    const choice = choicesRef.current[pickRef.current];
    setFan(false);
    if (!choice) return;
    haptics.commit();
    chooseRef.current?.(choice);
  }, []);
  const hideFan = React.useCallback(() => setFan(false), []);

  const gesture = React.useMemo(() => {
    const tap = Gesture.Tap()
      .maxDuration(ASK_HOLD_MS)
      .onEnd((_event, success) => {
        'worklet';
        if (success) runOnJS(press)();
      });
    if (!canAsk) return tap;
    // With helpers on: hold, then slide up the list and let go on a chat.
    const fanHold = Gesture.Pan()
      .activateAfterLongPress(ASK_HOLD_MS)
      .onBegin(() => {
        'worklet';
        charge.value = withTiming(1, { duration: ASK_HOLD_MS });
        runOnJS(startRamp)();
      })
      .onStart(() => {
        'worklet';
        runOnJS(showFan)();
      })
      .onUpdate((event) => {
        'worklet';
        runOnJS(moveFan)(event.translationY);
      })
      .onEnd(() => {
        'worklet';
        runOnJS(chooseFan)();
      })
      .onFinalize(() => {
        'worklet';
        charge.value = withTiming(0, { duration: 150 });
        runOnJS(stopRamp)();
        runOnJS(hideFan)();
      });
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
    return Gesture.Race(swipe, fanned ? fanHold : hold, tap);
  }, [canAsk, fanned, press, startRamp, stopRamp, holdOpen, swipeOpen, tick, showFan, moveFan, chooseFan, hideFan, charge, lift, armed]);

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
        {fan && choices ? <HoldChoices choices={choices} pick={pick} /> : null}
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * The hold's list of chats, rising above the +: the row under the finger is
 * filled and wears the Rooftap spectrum, so it is plain which one letting go
 * opens. Ask Rooftap sits next to the +.
 */
function HoldChoices({ choices, pick }: { choices: ChatChoice[]; pick: number }) {
  const { cardShadow } = useThemeMaterial();
  return (
    <View
      pointerEvents="none"
      className="absolute w-56 gap-1 rounded-2xl border border-border bg-popover p-1.5"
      style={{ bottom: 60, left: 24 - 112, boxShadow: cardShadow }}
    >
      {choices.map((c, i) => (
        <View key={c.helper ?? 'rooftap'} className={cn('h-11 flex-row items-center gap-2.5 rounded-xl px-2.5', i === pick && 'bg-muted')}>
          {i === pick ? <SpectrumOutline radius={11} /> : null}
          {c.helper ? <LeadingTile sectionId={c.helper} Icon={sectionIconFor(c.helper)} size="sm" /> : <RooftapTile size="sm" />}
          <Text className={cn('text-sm font-medium', i === pick ? 'text-foreground' : 'text-muted-foreground')}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}
