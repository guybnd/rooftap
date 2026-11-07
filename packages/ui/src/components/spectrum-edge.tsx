// Hearth §13 "Living edge": the Rooftap spectrum running round the edge of
// the Assistant's chat. It turns slowly at rest, faster while the person
// talks, and fast while Rooftap works (core ASSISTANT_EDGE_TURN_MS), easing
// between paces. While Rooftap works the ring also thickens and its width
// wobbles (ASSISTANT_EDGE_WIDTH, ASSISTANT_EDGE_WOBBLE). React Native has no conic gradient, so the colours are a
// static ring of SVG wedges on a square that rotates behind an opaque fill;
// only the view turns (animated SVG props broke on Android, Hearth §8).
// Reduced motion holds it still. Web twin: the .spectrum-edge rule in
// apps/web/src/app/globals.css.
import * as React from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import {
  ASSISTANT_EDGE_EASE_MS,
  ASSISTANT_EDGE_TURN_MS,
  ASSISTANT_EDGE_WIDTH,
  ASSISTANT_EDGE_WOBBLE,
  spectrumRing,
  type AssistantEdgePace,
} from '@homeup/core';
import { useStillMotion } from '../theme/theme-provider';

const WEDGES = 48;
const RING = spectrumRing(WEDGES);

/** The ring of wedges, drawn once on a 2x2 square centred on 0,0. */
const Wheel = React.memo(function Wheel({ size }: { size: number }) {
  const step = (Math.PI * 2) / WEDGES;
  return (
    <Svg width={size} height={size} viewBox="-1 -1 2 2">
      {RING.map((color, i) => {
        // A hair of overlap so no seam shows between wedges.
        const a0 = i * step - Math.PI / 2 - 0.004;
        const a1 = (i + 1) * step - Math.PI / 2 + 0.004;
        const d = `M0 0 L${(Math.cos(a0) * 1.5).toFixed(4)} ${(Math.sin(a0) * 1.5).toFixed(4)} L${(Math.cos(a1) * 1.5).toFixed(4)} ${(Math.sin(a1) * 1.5).toFixed(4)} Z`;
        return <Path key={i} d={d} fill={color} />;
      })}
    </Svg>
  );
});

export interface SpectrumEdgeProps {
  /** How busy Rooftap is: sets the turning speed. */
  pace?: AssistantEdgePace;
  /** Turns only while true (a hidden chat stops spending frames). */
  active?: boolean;
  /** The surface's corner radius. */
  radius: number;
  /** The surface colour that fills inside the ring. */
  fill: string;
}

/**
 * Fills its parent (absolutely) with the turning ring and the surface fill
 * inside it. Put it first in a surface with overflow hidden; the content
 * draws over it.
 */
export function SpectrumEdge({ pace = 'rest', active = true, radius, fill }: SpectrumEdgeProps) {
  const still = useStillMotion();
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (Math.abs(w - box.w) > 1 || Math.abs(h - box.h) > 1) setBox({ w, h });
  };
  // Degrees per ms, eased towards the pace's target each frame.
  const target = useSharedValue(360 / ASSISTANT_EDGE_TURN_MS[pace]);
  const speed = useSharedValue(target.value);
  const angle = useSharedValue(0);
  // The ring's width, eased the same way, and the wobble's strength (0 at rest, 1 while thinking).
  const targetWidth = useSharedValue<number>(ASSISTANT_EDGE_WIDTH[pace]);
  const width = useSharedValue<number>(ASSISTANT_EDGE_WIDTH[pace]);
  const targetWobble = useSharedValue(pace === 'thinking' ? 1 : 0);
  const wobble = useSharedValue(targetWobble.value);
  const clock = useSharedValue(0);
  React.useEffect(() => {
    target.value = 360 / ASSISTANT_EDGE_TURN_MS[pace];
    targetWidth.value = ASSISTANT_EDGE_WIDTH[pace];
    targetWobble.value = pace === 'thinking' ? 1 : 0;
    // Reduced motion: no turning or wobble, but the width still says how busy it is.
    if (still) width.value = ASSISTANT_EDGE_WIDTH[pace];
  }, [pace, still, target, targetWidth, targetWobble, width]);
  const frame = useFrameCallback((info) => {
    'worklet';
    const dt = Math.min(info.timeSincePreviousFrame ?? 16, 64);
    const k = Math.min(1, dt / (ASSISTANT_EDGE_EASE_MS / 3));
    speed.value += (target.value - speed.value) * k;
    angle.value = (angle.value + speed.value * dt) % 360;
    width.value += (targetWidth.value - width.value) * k;
    wobble.value += (targetWobble.value - wobble.value) * k;
    clock.value = (clock.value + dt) % ASSISTANT_EDGE_WOBBLE.periodMs;
  }, false);
  React.useEffect(() => {
    frame.setActive(active && !still);
  }, [active, still, frame]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));
  const inner = useAnimatedStyle(() => {
    const w = width.value + wobble.value * ASSISTANT_EDGE_WOBBLE.px * Math.sin((clock.value / ASSISTANT_EDGE_WOBBLE.periodMs) * Math.PI * 2);
    return { top: w, left: w, right: w, bottom: w, borderRadius: Math.max(0, radius - w) };
  });

  const side = Math.ceil(Math.hypot(box.w, box.h)) + 4;
  return (
    <View pointerEvents="none" onLayout={onLayout} style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      {side > 4 && (
        <Animated.View style={[{ position: 'absolute', width: side, height: side, left: (box.w - side) / 2, top: (box.h - side) / 2 }, spin]}>
          <Wheel size={side} />
        </Animated.View>
      )}
      <Animated.View style={[{ position: 'absolute', backgroundColor: fill }, inner]} />
    </View>
  );
}
