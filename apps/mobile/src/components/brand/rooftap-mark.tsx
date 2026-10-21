// The Rooftap mark in one colour (core ROOFTAP_MARK), drawn in currentColor
// so a text-* class sets it. Web twin: apps/web/src/components/brand/rooftap-mark.tsx.
import Svg, { Circle, Path } from 'react-native-svg';
import { cssInterop } from 'nativewind';
import { ROOFTAP_MARK } from '@homeup/core';

cssInterop(Svg, { className: { target: 'style', nativeStyleToProp: { color: true } } });

export function RooftapMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Svg width={size} height={size} viewBox={ROOFTAP_MARK.viewBox} className={className} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={ROOFTAP_MARK.roof} fill="none" stroke="currentColor" strokeWidth={ROOFTAP_MARK.roofStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={ROOFTAP_MARK.dot.cx} cy={ROOFTAP_MARK.dot.cy} r={ROOFTAP_MARK.dot.r} fill="currentColor" />
    </Svg>
  );
}
