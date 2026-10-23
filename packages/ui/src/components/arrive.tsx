// Hearth §8.1 "Arrive" (native): a section root that mounts after its tab
// slide fills in as a cascade. Its blocks (cards, list groups, Hero ledes)
// fade and rise into place one after another, in mount order, which is top
// to bottom. A block inside another block arrives with it. Only blocks that
// mount while the page is arriving take part: a revisit, a later scroll or
// a row that loads in afterwards just appears. Opacity and translateY on
// the UI thread only. Web twin: apps/web/src/lib/view-transitions.ts.
import * as React from 'react';
import { View, type ViewProps } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { ARRIVE, arriveDelayMs } from '@homeup/core';

interface ArriveState {
  until: number;
  count: { n: number };
}

const ArriveContext = React.createContext<ArriveState | null>(null);

const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** Counts the blocks that arrived under an `ArriveScope`. */
export interface ArriveCounter {
  n: number;
}

/**
 * Marks a subtree as arriving: blocks that mount inside it in the next
 * `ARRIVE.windowMs` cascade in. Pass `counter` to learn how many did.
 */
export function ArriveScope({ counter, children }: { counter?: ArriveCounter; children: React.ReactNode }) {
  const [state] = React.useState<ArriveState>(() => ({
    until: Date.now() + ARRIVE.windowMs,
    count: counter ?? { n: 0 },
  }));
  return <ArriveContext.Provider value={state}>{children}</ArriveContext.Provider>;
}

/** This block's place in its page's cascade, or -1 when it doesn't arrive. Fixed for the block's life. */
function useArriveSlot(): number {
  const state = React.useContext(ArriveContext);
  const [slot] = React.useState(() => (state && Date.now() < state.until ? state.count.n++ : -1));
  return slot;
}

function ArrivingView({ slot, style, ...props }: ViewProps & { slot: number }) {
  const progress = useSharedValue(0);
  React.useEffect(() => {
    progress.value = withDelay(arriveDelayMs(slot), withTiming(1, { duration: ARRIVE.durationMs, easing: SWIFT_OUT }));
  }, [progress, slot]);
  const arrive = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * ARRIVE.risePx }],
  }));
  return <Animated.View style={[style, arrive]} {...props} />;
}

/**
 * A drop-in `View` for a block's root (Card, ListGroup, HeroLede): it
 * cascades in when its page is arriving and is a plain View otherwise.
 */
export function ArriveView({ children, ...props }: ViewProps) {
  const slot = useArriveSlot();
  // Blocks inside this one arrive with it.
  const inner = <ArriveContext.Provider value={null}>{children}</ArriveContext.Provider>;
  if (slot < 0) return <View {...props}>{inner}</View>;
  return (
    <ArrivingView slot={slot} {...props}>
      {inner}
    </ArrivingView>
  );
}
