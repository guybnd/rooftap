// HOUP-171: native port of apps/web's src/components/ui/meridian-axis.tsx —
// "one vertical gilt axis per surface" (hearth.md §10.1, epic FLUX-1567).
// Web gates purely in CSS (`.meridian-axis { display: none }`, revealed only
// under `[data-theme="axis-mundi-night"|"axis-mundi-day"]`); RN has no
// selector-based cascade, so the same no-op default is reproduced here via
// useThemeMaterial().axisColor (theme-vars.ts), which resolves to `null`
// under any non-Axis-Mundi theme — mirrors --font-inscription's gating
// (HOUP-170). `hero` = the home lede's fading center line + small glowing
// top node (the gradient/glow via react-native-svg, already a dependency —
// no new native module added for one decorative line). `dock` = the mobile
// tab bar's short center tick. Never mount a third call site without
// re-reading hearth.md's "one meridian per surface" rule first — it does not
// belong in dense list rows.
import * as React from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useThemeMaterial } from '../theme/theme-provider';

export interface MeridianAxisProps {
  variant: 'hero' | 'dock';
}

// HOUP-183: no app-wide reduced-motion hook exists yet, so this mirrors
// globals.css's `@media (prefers-reduced-motion: reduce)` (:1185-1190)
// locally — the only current consumer of shadow/elevation on this axis.
function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export function MeridianAxis({ variant }: MeridianAxisProps) {
  const { axisColor } = useThemeMaterial();
  const reduceMotion = useReduceMotion();
  if (!axisColor) return null;

  if (variant === 'dock') {
    return (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 6,
          width: 2,
          height: 6,
          marginLeft: -1,
          borderRadius: 1,
          backgroundColor: axisColor,
        }}
      />
    );
  }

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, marginLeft: -0.5 }}
    >
      <Svg width={1} height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          {/* Mirrors globals.css's `linear-gradient(to bottom, --axis 0%, color-mix(--axis 35%) 40%, transparent 100%)`. */}
          <LinearGradient id="meridianFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={axisColor} stopOpacity={1} />
            <Stop offset="0.4" stopColor={axisColor} stopOpacity={0.35} />
            <Stop offset="1" stopColor={axisColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={1} height="100%" fill="url(#meridianFade)" />
      </Svg>
      {/* The sole decorative glow this product allows outside focus rings (Hearth §10.1) — static, never animated, and flattened under reduced motion (globals.css:1185-1190). */}
      <View
        style={{
          position: 'absolute',
          top: -3,
          left: '50%',
          width: 6,
          height: 6,
          marginLeft: -3,
          borderRadius: 9999,
          backgroundColor: axisColor,
          ...(reduceMotion
            ? null
            : {
                shadowColor: axisColor,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.65,
                shadowRadius: 8,
                elevation: 4,
              }),
        }}
      />
    </View>
  );
}
