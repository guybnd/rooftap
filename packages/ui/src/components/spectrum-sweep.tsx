// Hearth §8 "Spectrum sweep": a soft band of the roof colours passes down
// the screen once, when a whole list is done (the last grocery got). Put it
// last in the screen; each new `play` value sweeps once. It never takes a
// touch and draws nothing under reduced motion. Numbers from core's
// touches.ts. Web twin: apps/web/src/components/ui/spectrum-sweep.tsx.
import * as React from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ROOFTAP_SPECTRUM, SPECTRUM_SWEEP_ALPHA, SPECTRUM_SWEEP_BAND, SPECTRUM_SWEEP_MS } from '@homeup/core';
import { useStillMotion } from '../theme/theme-provider';

const EASE_IN_OUT = Easing.bezier(0.45, 0, 0.55, 1);

export function SpectrumSweep({ play }: { /** Sweeps once each time this number changes (0 never sweeps). */ play: number }) {
  const still = useStillMotion();
  const { height } = useWindowDimensions();
  const band = Math.round(height * SPECTRUM_SWEEP_BAND);
  const y = useSharedValue(-band);
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    if (!play || still) return;
    setOn(true);
    y.value = -band;
    y.value = withTiming(height, { duration: SPECTRUM_SWEEP_MS, easing: EASE_IN_OUT });
    const t = setTimeout(() => setOn(false), SPECTRUM_SWEEP_MS + 50);
    return () => clearTimeout(t);
  }, [play, still, band, height, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  if (!on) return null;
  const stripe = band / (ROOFTAP_SPECTRUM.length + 2);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
      <Animated.View style={[{ height: band }, style]}>
        {/* A faint lead-in and tail, then one stripe per roof colour. */}
        <View style={{ height: stripe, backgroundColor: ROOFTAP_SPECTRUM[0], opacity: SPECTRUM_SWEEP_ALPHA / 3 }} />
        {ROOFTAP_SPECTRUM.map((c) => (
          <View key={c} style={{ height: stripe, backgroundColor: c, opacity: SPECTRUM_SWEEP_ALPHA }} />
        ))}
        <View style={{ height: stripe, backgroundColor: ROOFTAP_SPECTRUM[ROOFTAP_SPECTRUM.length - 1], opacity: SPECTRUM_SWEEP_ALPHA / 3 }} />
      </Animated.View>
    </View>
  );
}
