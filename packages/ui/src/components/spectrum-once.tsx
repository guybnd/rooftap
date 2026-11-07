// Hearth §8 "Spectrum once": a card the Assistant just filled with what it
// did arrives with one turn of the spectrum edge, then rests plain. Put it
// last in the card's positioned wrapper with the card's corner radius; it
// plays on mount and then draws nothing. React Native has no conic
// gradient, so the edge runs through the roof colours in time rather than
// round the card. Still motion: nothing. Web twin: `.spectrum-once` in
// apps/web/src/app/globals.css.
import * as React from 'react';
import Animated, { Easing, interpolate, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ROOFTAP_SPECTRUM, SPECTRUM_ONCE_MS } from '@homeup/core';
import { useStillMotion } from '../theme/theme-provider';

const COLORS = [...ROOFTAP_SPECTRUM, ROOFTAP_SPECTRUM[0]];
const AT = COLORS.map((_, i) => i / (COLORS.length - 1));

export function SpectrumOnce({ radius, width = 2 }: { radius: number; width?: number }) {
  const still = useStillMotion();
  const [done, setDone] = React.useState(false);
  const t = useSharedValue(0);
  React.useEffect(() => {
    if (still) return;
    t.value = withTiming(1, { duration: SPECTRUM_ONCE_MS, easing: Easing.bezier(0.45, 0, 0.55, 1) }, (finished) => {
      if (finished) runOnJS(setDone)(true);
    });
  }, [still, t]);
  const style = useAnimatedStyle(() => ({
    borderColor: interpolateColor(t.value, AT, COLORS),
    opacity: interpolate(t.value, [0, 0.12, 0.8, 1], [0, 1, 1, 0]),
  }));
  if (still || done) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: radius, borderWidth: width }, style]}
    />
  );
}
