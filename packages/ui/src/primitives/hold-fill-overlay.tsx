// HOUP-68: native port of apps/web/src/components/ui/hold-fill-overlay.tsx.
// Same visual contract — two grey bars sweep in from both ends and a pencil
// fades/scales in at centre as `progress` (0->1) ramps — but the "ease the
// early-lift retreat at --motion-fast" behavior is expressed with Reanimated
// (`withTiming`) instead of a CSS transition class toggle, since RN has no
// CSS transition engine.
import * as React from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Pencil } from 'lucide-react-native';

// Mirrors @homeup/core's MOTION_DURATIONS_MS.fast — the retreat-from-an-early-lift ease.
const MOTION_FAST_MS = 150;

export function HoldFillOverlay({ progress }: { progress: number }) {
  const animatedProgress = useSharedValue(progress);
  const prevProgress = React.useRef(progress);

  React.useEffect(() => {
    const prev = prevProgress.current;
    prevProgress.current = progress;
    // An early lift snaps progress straight to 0 (the underlying long-press
    // timer resets), which reads as a glitch — ease that specific drop back
    // out instead of snapping the fill away instantly. Any other change
    // (the frame-accurate 0->1 ramp itself) stays untransitioned.
    if (progress === 0 && prev > 0) {
      animatedProgress.value = withTiming(0, { duration: MOTION_FAST_MS });
    } else {
      animatedProgress.value = progress;
    }
  }, [progress, animatedProgress]);

  const leftBarStyle = useAnimatedStyle(() => ({ width: `${animatedProgress.value * 50}%` }));
  const rightBarStyle = useAnimatedStyle(() => ({ width: `${animatedProgress.value * 50}%` }));
  const iconStyle = useAnimatedStyle(() => ({
    opacity: animatedProgress.value,
    transform: [{ scale: 0.6 + animatedProgress.value * 0.4 }],
  }));

  return (
    <View pointerEvents="none" className="absolute inset-0 z-0">
      <Animated.View className="absolute inset-y-0 left-0 bg-muted-foreground/25" style={leftBarStyle} />
      <Animated.View className="absolute inset-y-0 right-0 bg-muted-foreground/25" style={rightBarStyle} />
      <Animated.View className="absolute inset-0 flex items-center justify-center" style={iconStyle}>
        <Pencil size={16} className="text-foreground" />
      </Animated.View>
    </View>
  );
}
