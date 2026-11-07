// The Rooftap mark (core ROOFTAP_MARK). RooftapMark draws it in one colour,
// currentColor, so a text-* class sets it. RooftapTile is the app icon in
// small: the spectrum roof and coral tap dot on the icon's dark tile, which
// is how Rooftap shows up in its own chat. Web twin:
// apps/web/src/components/brand/rooftap-mark.tsx.
import * as React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { cssInterop } from 'nativewind';
import { ROOFTAP_MARK, ROOFTAP_SPECTRUM, ROOFTAP_TILE } from '@homeup/core';
import { useStillMotion } from '@homeup/ui';

cssInterop(Svg, { className: { target: 'style', nativeStyleToProp: { color: true } } });

export function RooftapMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Svg width={size} height={size} viewBox={ROOFTAP_MARK.viewBox} className={className} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={ROOFTAP_MARK.roof} fill="none" stroke="currentColor" strokeWidth={ROOFTAP_MARK.roofStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={ROOFTAP_MARK.dot.cx} cy={ROOFTAP_MARK.dot.cy} r={ROOFTAP_MARK.dot.r} fill="currentColor" />
    </Svg>
  );
}

/**
 * The mark as a section glyph, shaped like a lucide icon (size, color,
 * className) so the tab bar, section lists and leading tiles can draw it
 * wherever they draw a section's icon (section-icons.ts `rooftap`).
 */
export function RooftapGlyph({ size = 24, color, className }: { size?: number; color?: string; className?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox={ROOFTAP_MARK.viewBox} color={color} className={className} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={ROOFTAP_MARK.roof} fill="none" stroke="currentColor" strokeWidth={ROOFTAP_MARK.roofStroke * 0.85} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={ROOFTAP_MARK.dot.cx} cy={ROOFTAP_MARK.dot.cy} r={ROOFTAP_MARK.dot.r} fill="currentColor" />
    </Svg>
  );
}

const TILE = { sm: { box: 28, radius: 9, mark: 20 }, md: { box: 36, radius: 11, mark: 26 }, xl: { box: 56, radius: 17, mark: 40 } } as const;
// The viewBox, so the dot can be placed as a view over the roof.
const VB = { x: 172, y: 163, size: 680 };

/**
 * Rooftap's avatar: the app icon in small. `working` makes the tap dot hop
 * over the roof while Rooftap is thinking (the dot is a view of its own, so
 * only a transform animates; reduced motion keeps it still).
 */
export function RooftapTile({ size = 'md', working = false }: { size?: keyof typeof TILE; working?: boolean }) {
  const t = TILE[size];
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const still = useStillMotion();
  const scale = t.mark / VB.size;
  const dot = ROOFTAP_MARK.dot.r * 2 * scale;
  const inset = (t.box - t.mark) / 2;
  const hop = useSharedValue(0);
  React.useEffect(() => {
    if (!working || still) {
      cancelAnimation(hop);
      hop.value = withTiming(0, { duration: 150 });
      return;
    }
    const up = Easing.bezier(0.33, 0, 0.67, 1);
    hop.value = withRepeat(withSequence(withTiming(1, { duration: 420, easing: up }), withTiming(0, { duration: 420, easing: Easing.bezier(0.33, 0, 0.2, 1) })), -1);
    return () => cancelAnimation(hop);
  }, [working, still, hop]);
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -hop.value * t.mark * 0.42 }] }));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: t.box, height: t.box, borderRadius: t.radius, backgroundColor: ROOFTAP_TILE }}
    >
      <Svg width={t.mark} height={t.mark} viewBox={ROOFTAP_MARK.viewBox} style={{ position: 'absolute', left: inset, top: inset }}>
        <Defs>
          <LinearGradient id={`roof${id}`} gradientUnits="userSpaceOnUse" x1="232" y1="0" x2="792" y2="0">
            {ROOFTAP_SPECTRUM.map((c, i) => (
              <Stop key={c} offset={i / (ROOFTAP_SPECTRUM.length - 1)} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        <Path d={ROOFTAP_MARK.roof} fill="none" stroke={`url(#roof${id})`} strokeWidth={ROOFTAP_MARK.roofStroke} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: ROOFTAP_SPECTRUM[0],
            left: inset + (ROOFTAP_MARK.dot.cx - VB.x) * scale - dot / 2,
            top: inset + (ROOFTAP_MARK.dot.cy - VB.y) * scale - dot / 2,
          },
          dotStyle,
        ]}
      />
    </View>
  );
}
