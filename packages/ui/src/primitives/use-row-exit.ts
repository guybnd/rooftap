// HOUP-120: state-machine port of apps/web/src/app/tasks/task-row.tsx's
// `useRowExit` — the "complete settles for a beat, then collapses" /
// "snooze slides out" choreography behind a swipeable row. Web transitions a
// CSS `grid-template-rows: 1fr -> 0fr` for the collapse; RN has no
// grid/auto-height transition to lean on, so this fades + translates instead
// (the same trade-off `ListItemBody` already made with Reanimated
// FadeIn/FadeOut in list-item.tsx). Lives in packages/ui (not app-local)
// because it shares swipe-actions.tsx's `useSharedValue`/`withTiming`
// mutation pattern — any row wired to `SwipeActions` can reuse it.
import * as React from 'react';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { success } from '../lib/haptics';

const COMPLETE_BEAT_MS = 1200;
const ROW_EXIT_MS = 240;

export type RowExitPhase = 'idle' | 'done-settling' | 'collapsing' | 'snoozing';

export function useRowExit<TSnoozeReason = void>(onComplete: () => void, onSnoozed: (reason: TSnoozeReason) => void) {
  const [phase, setPhase] = React.useState<RowExitPhase>('idle');
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const opacity = useSharedValue(1);
  const translateX = useSharedValue(0);

  const clearTimers = React.useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  React.useEffect(() => clearTimers, [clearTimers]);

  const startComplete = React.useCallback(() => {
    setPhase((p) => {
      if (p !== 'idle') return p;
      success();
      timers.current.push(
        setTimeout(() => {
          setPhase('collapsing');
          opacity.value = withTiming(0, { duration: ROW_EXIT_MS });
          timers.current.push(setTimeout(onComplete, ROW_EXIT_MS));
        }, COMPLETE_BEAT_MS)
      );
      return 'done-settling';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onComplete]);

  const cancelComplete = React.useCallback(() => {
    clearTimers();
    opacity.value = withTiming(1, { duration: ROW_EXIT_MS });
    translateX.value = withTiming(0, { duration: ROW_EXIT_MS });
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimers]);

  const startSnooze = React.useCallback(
    (reason: TSnoozeReason) => {
      setPhase((p) => {
        if (p !== 'idle') return p;
        opacity.value = withTiming(0, { duration: ROW_EXIT_MS });
        translateX.value = withTiming(-80, { duration: ROW_EXIT_MS });
        timers.current.push(setTimeout(() => onSnoozed(reason), ROW_EXIT_MS));
        return 'snoozing';
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [onSnoozed]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  return {
    phase,
    pendingDone: phase === 'done-settling' || phase === 'collapsing',
    startComplete,
    cancelComplete,
    startSnooze,
    animatedStyle,
  };
}
