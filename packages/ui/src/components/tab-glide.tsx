// Hearth §8 "Tab glide" (native): the tab bar's one travelling highlight.
// The bar measures its tabs and hands this the active face's centre; this
// draws the pebble behind the tabs and glides it to the new tab whenever
// that centre moves. The glide runs on the page shift's own timing (Hearth
// `slow`, swift-out, the same spec the (tabs) navigator slides the page
// with) and sets off in the same JS turn the navigator starts the page, so
// the two move as one; the stretch rides that same progress (core
// tabGlideEdges). Its fill blends from the old section's tile hue to the
// new one on the same timing.
//
// The pebble is a plain rounded view with uneven corners, moved, stretched
// and leaned with transforms only (core tabPebbleMetrics), and coloured
// with an animated background. The first cut drew web's SVG outline with
// animated path props and crossfaded two fills through animated SVG
// opacity; on Android it turned into a square after the first tab switch,
// so native sticks to the transform, opacity and colour styles Reanimated
// already drives elsewhere in the app.
// Web twin: apps/web/src/components/ui/tab-glide.tsx.
import * as React from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  MOTION_DURATIONS_MS,
  TAB_GLIDE_SIZE,
  motionEaseOut,
  tabGlideEdges,
  tabPebbleMetrics,
} from '@homeup/core';
import { useStillMotion } from '../theme/theme-provider';

// The page shift's spec ((tabs) navigator transitionSpec): Hearth `slow`,
// swift-out.
const GLIDE = { duration: MOTION_DURATIONS_MS.slow, easing: Easing.bezier(0.16, 1, 0.3, 1) };
const HALF = TAB_GLIDE_SIZE.width / 2;
const REST_W = TAB_GLIDE_SIZE.width;
const REST_H = TAB_GLIDE_SIZE.height;
// Degrees of forward lean at full stretch: the top runs ahead of the base.
const LEAN_DEG = 10;

export interface TabGlideTarget {
  /** Centre of the active tab's face, in the bar's own coordinates. */
  cx: number;
  cy: number;
}

export interface TabGlideProps {
  /** Null hides the pebble (nothing in the bar is active, or not measured yet). */
  target: TabGlideTarget | null;
  /** The active section's tile hue. */
  color: string | undefined;
}

export function TabGlide({ target, color }: TabGlideProps) {
  const reduceMotion = useStillMotion();
  // One glide: from one tab centre to the next, `progress` 0 to 1 eased.
  const fromCx = useSharedValue(0);
  const toCx = useSharedValue(0);
  const progress = useSharedValue(1);
  const cy = useSharedValue(0);
  const dir = useSharedValue(0);
  const shown = useSharedValue(0);
  const fromColor = useSharedValue(color ?? 'transparent');
  const toColor = useSharedValue(color ?? 'transparent');
  const mix = useSharedValue(1);
  // The JS side's copy of the trip in flight, so a tab tapped before the
  // last glide lands can set off from where the pebble is now.
  const trip = React.useRef<{ from: number; to: number; at: number } | null>(null);
  const lastColor = React.useRef(color);

  React.useEffect(() => {
    if (!color || color === lastColor.current) return;
    fromColor.value = lastColor.current ?? color;
    toColor.value = color;
    lastColor.current = color;
    if (reduceMotion) {
      mix.value = 1;
      return;
    }
    mix.value = 0;
    mix.value = withTiming(1, GLIDE);
  }, [color, reduceMotion, fromColor, toColor, mix]);

  const cx = target?.cx;
  const targetCy = target?.cy;
  React.useEffect(() => {
    if (cx == null || targetCy == null) {
      trip.current = null;
      shown.value = 0;
      return;
    }
    cy.value = targetCy;
    const last = trip.current;
    const now = Date.now();
    if (last == null || reduceMotion) {
      // First placement (or reduced motion): land in place, no travel.
      trip.current = { from: cx, to: cx, at: now };
      dir.value = 0;
      fromCx.value = cx;
      toCx.value = cx;
      progress.value = 1;
      shown.value = 1;
      return;
    }
    if (last.to === cx) return;
    const t = (now - last.at) / GLIDE.duration;
    const from = t < 1 ? last.from + (last.to - last.from) * motionEaseOut(t) : last.to;
    trip.current = { from, to: cx, at: now };
    dir.value = cx > from ? 1 : -1;
    fromCx.value = from;
    toCx.value = cx;
    progress.value = 0;
    progress.value = withTiming(1, GLIDE);
  }, [cx, targetCy, reduceMotion, fromCx, toCx, progress, cy, dir, shown]);

  const pebbleStyle = useAnimatedStyle(() => {
    const { left, right } = tabGlideEdges(fromCx.value, toCx.value, progress.value, REST_W);
    const m = tabPebbleMetrics(left, right, REST_W, REST_H, dir.value);
    return {
      opacity: shown.value,
      backgroundColor: interpolateColor(mix.value, [0, 1], [fromColor.value, toColor.value]),
      transform: [
        { translateX: m.cx - HALF },
        { translateY: cy.value - REST_H / 2 },
        { scaleX: m.width / REST_W },
        { scaleY: m.height / REST_H },
        { skewX: `${-m.lean * LEAN_DEG}deg` },
      ],
    };
  });

  return <Animated.View pointerEvents="none" style={[styles.pebble, pebbleStyle]} />;
}

const styles = StyleSheet.create({
  // A gently lopsided pebble rather than a stadium: the crest rounds off
  // wider on the top left and bottom right, tighter on the other two.
  pebble: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: REST_W,
    height: REST_H,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 17,
    borderBottomRightRadius: 21,
    borderBottomLeftRadius: 15,
  },
});
