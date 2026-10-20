// HOUP-132: native port of apps/web globals.css's per-theme `body::before`
// background-texture rule — a static, non-animated, low-opacity pattern
// painted behind app content. Absolutely positioned + pointerEvents="none",
// so mounting it is a structural no-op for touch/scroll; "none" (both Axis
// Mundi faces today) or an opacity of 0 renders nothing at all.
//
// Built on react-native-svg's tiled <Pattern> rather than expo-linear-
// gradient: a repeating grid/dot lattice at a fixed pixel pitch (48px/20px)
// isn't expressible as a linear gradient, and expo-linear-gradient isn't a
// dependency of this app. react-native-svg already is (apps/mobile +
// packages/ui both depend on it).
import * as React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Path, Pattern, Rect } from 'react-native-svg';
import type { BodyTextureKind } from '@homeup/core';

export interface BackgroundTextureProps {
  kind: BodyTextureKind;
  /** 0-1, mirrors globals.css's `--texture-opacity`. */
  opacity: number;
  /** `rgb(r, g, b)` — the theme's `--color-border`, matching web's line/dot color. */
  color: string;
}

const GRID_SIZE = 48;
const DASHED_SIZE = 48;
const DOTS_SIZE = 20;

export function BackgroundTexture({ kind, opacity, color }: BackgroundTextureProps) {
  if (kind === 'none' || opacity <= 0) return null;

  const patternId = `hearth-texture-${kind}`;

  return (
    <View pointerEvents="none" className="absolute inset-0 z-0" style={{ opacity }}>
      <Svg width="100%" height="100%">
        <Defs>
          {kind === 'grid' && (
            <Pattern id={patternId} width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
              <Path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke={color} strokeWidth={1} />
            </Pattern>
          )}
          {kind === 'dashed' && (
            <Pattern id={patternId} width={DASHED_SIZE} height={DASHED_SIZE} patternUnits="userSpaceOnUse">
              <Path
                d={`M ${DASHED_SIZE} 0 L 0 0 0 ${DASHED_SIZE}`}
                fill="none"
                stroke={color}
                strokeWidth={3}
                strokeDasharray="3 5"
              />
            </Pattern>
          )}
          {kind === 'dots' && (
            <Pattern id={patternId} width={DOTS_SIZE} height={DOTS_SIZE} patternUnits="userSpaceOnUse">
              <Circle cx={1} cy={1} r={1} fill={color} />
            </Pattern>
          )}
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </Svg>
    </View>
  );
}
