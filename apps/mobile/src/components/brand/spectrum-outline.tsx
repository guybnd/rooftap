// The Rooftap spectrum as a thin outline round whatever is picked: the chat
// floated up in the popup's strip, the chat under the finger in the hold's
// list. Same colours as the chat card's living edge. Web draws it with a
// gradient border (assistant-chat-popup.tsx, capture-buttons.tsx).
import * as React from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { ROOFTAP_SPECTRUM } from '@homeup/core';

/** Fills its parent (absolute inset-0). `radius` defaults to a pill. */
export function SpectrumOutline({ radius, stroke = 1.5 }: { radius?: number; stroke?: number }) {
  const id = `spectrum-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  return (
    <View
      pointerEvents="none"
      className="absolute inset-0"
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
      }}
    >
      {size ? (
        <Svg width={size.w} height={size.h}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
              {ROOFTAP_SPECTRUM.map((c, i) => (
                <Stop key={c} offset={i / (ROOFTAP_SPECTRUM.length - 1)} stopColor={c} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect
            x={stroke / 2}
            y={stroke / 2}
            width={size.w - stroke}
            height={size.h - stroke}
            rx={radius ?? (size.h - stroke) / 2}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={stroke}
          />
        </Svg>
      ) : null}
    </View>
  );
}
