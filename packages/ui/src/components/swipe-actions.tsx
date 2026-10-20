// HOUP-68: native port of apps/web/src/components/ui/swipe-actions.tsx
// (Hearth M3: right=complete/left=snooze). The web version hand-rolls pointer
// tracking because the browser gives no gesture primitive; on native,
// react-native-gesture-handler's `Gesture.Pan` + Reanimated own the tracking,
// threshold-crossing tick() haptic, and the clamp/spring-back.
import * as React from 'react';
import { Text, View, type ViewProps } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { cn } from '../lib/cn';
import { select, tick } from '../lib/haptics';

export interface SwipeConfig {
  /** Background tint class shown while dragging below the trigger threshold. */
  bg: string;
  /** Stronger background class once past the trigger threshold (action will fire). */
  activeBg: string;
  /** Icon revealed behind the row. */
  icon: React.ReactNode;
  /** Short action label shown beside the icon (e.g. "Got it", "Uncheck"). */
  label?: string;
}

export interface SwipeActionsProps extends ViewProps {
  children: React.ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  right?: SwipeConfig;
  left?: SwipeConfig;
  disabled?: boolean;
  /**
   * Fires after a sustained press-and-hold. Composed with the swipe `Pan` via
   * `Gesture.Race` so RNGH's own arbitration picks a winner — nesting a plain
   * RN `Pressable.onLongPress` inside this component's `GestureDetector`
   * (the pre-HOUP-198 approach on task/setup/grocery rows) doesn't reliably
   * fire: the Pan recognizer claims the native touch responder before the
   * Pressable's JS-timer-based long-press can complete, most visible on
   * release builds. Omit to disable long-press entirely.
   */
  onLongPress?: () => void;
  /** Hold duration before `onLongPress` fires (ms). Default 500. */
  longPressMs?: number;
  /** Fires when a hold begins (press-down, before pan-vs-hold is resolved) — drive a `holdProgress` fill from here. */
  onHoldStart?: () => void;
  /** Fires when the hold ends (release, cancel, or a resolved long-press). */
  onHoldEnd?: () => void;
}

const TRIGGER = 72; // px past which the action fires on release
const MAX = 200; // px clamp
const LONG_PRESS_SLOP_PX = 10; // matches Gesture.LongPress's own default maxDistance

export function SwipeActions({
  children,
  onSwipeRight,
  onSwipeLeft,
  right,
  left,
  disabled,
  onLongPress,
  longPressMs = 500,
  onHoldStart,
  onHoldEnd,
  className,
  ...props
}: SwipeActionsProps) {
  const offset = useSharedValue(0);
  const [displayOffset, setDisplayOffset] = React.useState(0);
  const crossedTrigger = React.useRef(false);

  const syncDisplayOffset = React.useCallback((value: number) => setDisplayOffset(value), []);
  const fireTick = React.useCallback(() => tick(), []);
  const fireRight = React.useCallback(() => onSwipeRight?.(), [onSwipeRight]);
  const fireLeft = React.useCallback(() => onSwipeLeft?.(), [onSwipeLeft]);
  const fireLongPress = React.useCallback(() => onLongPress?.(), [onLongPress]);
  const fireHoldStart = React.useCallback(() => onHoldStart?.(), [onHoldStart]);
  const fireHoldEnd = React.useCallback(() => onHoldEnd?.(), [onHoldEnd]);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-8, 8])
    .failOffsetY([-16, 16])
    .onUpdate((event) => {
      'worklet';
      const next = event.translationX > 0 ? (onSwipeRight ? event.translationX : 0) : onSwipeLeft ? event.translationX : 0;
      const clamped = Math.max(-MAX, Math.min(MAX, next));
      offset.value = clamped;
      runOnJS(syncDisplayOffset)(clamped);
    })
    .onEnd((event) => {
      'worklet';
      const o = offset.value;
      if (o >= TRIGGER) runOnJS(fireRight)();
      else if (o <= -TRIGGER) runOnJS(fireLeft)();
      offset.value = withTiming(0, { duration: 200 });
      runOnJS(syncDisplayOffset)(0);
    });

  // Raced (not composed simultaneously) against `pan`: whichever resolves
  // first wins and cancels the other, so a stationary hold arms the fill
  // while any real horizontal drag hands off to the swipe as before.
  const longPress = Gesture.LongPress()
    .enabled(!disabled && !!onLongPress)
    .minDuration(longPressMs)
    .maxDistance(LONG_PRESS_SLOP_PX)
    .onBegin(() => {
      'worklet';
      runOnJS(fireHoldStart)();
    })
    .onStart(() => {
      'worklet';
      runOnJS(fireLongPress)();
    })
    .onFinalize(() => {
      'worklet';
      runOnJS(fireHoldEnd)();
    });

  const composedGesture = onLongPress ? Gesture.Race(pan, longPress) : pan;

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  React.useEffect(() => {
    const past = Math.abs(displayOffset) >= TRIGGER;
    // Arming clicks firm; pulling back under the line clicks softer (disarmed).
    if (past && !crossedTrigger.current) fireTick();
    else if (!past && crossedTrigger.current && displayOffset !== 0) select();
    crossedTrigger.current = past;
  }, [displayOffset, fireTick]);

  const abs = Math.abs(displayOffset);
  const active = abs >= TRIGGER;
  const cfg = displayOffset > 0 ? right : displayOffset < 0 ? left : undefined;

  // Underlay content (icon/label/direction) is fine to lag slightly on JS
  // state, but the underlay must *disappear* the instant offset.value
  // returns to 0 on the UI thread — retain the last-shown cfg/direction so
  // the opacity-driven unmount below never races an empty render.
  const lastEntryRef = React.useRef<{ cfg: SwipeConfig; positive: boolean } | undefined>(undefined);
  if (cfg) lastEntryRef.current = { cfg, positive: displayOffset > 0 };
  const entry = lastEntryRef.current;

  const underlayStyle = useAnimatedStyle(() => ({ opacity: offset.value !== 0 ? 1 : 0 }));

  const iconTone = entry && React.isValidElement(entry.cfg.icon)
    ? (entry.cfg.icon.props as { className?: string }).className
    : undefined;

  return (
    <View className={cn('relative overflow-hidden rounded-2xl', className)} {...props}>
      {entry && (
        <Animated.View
          style={underlayStyle}
          className={cn(
            'absolute inset-0 flex-row items-center rounded-2xl',
            active ? entry.cfg.activeBg : entry.cfg.bg,
            entry.positive ? 'justify-start pl-4' : 'justify-end pr-4'
          )}
          accessible={!!entry.cfg.label}
          accessibilityLabel={entry.cfg.label}
        >
          <View
            className="flex-row items-center gap-2"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {entry.cfg.icon}
            {entry.cfg.label && (
              <Text
                numberOfLines={1}
                className={cn(
                  'text-sm font-semibold tracking-tight',
                  active ? 'text-white' : iconTone,
                  active ? 'opacity-100' : 'opacity-70'
                )}
              >
                {entry.cfg.label}
              </Text>
            )}
          </View>
        </Animated.View>
      )}
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={cardStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
