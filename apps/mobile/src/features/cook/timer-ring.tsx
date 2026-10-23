// Recipes v2: a timer's progress ring (mockups 3A, 1D), native twin of
// apps/web/src/components/cook/timer-ring.tsx. Primary while it runs,
// destructive once done, muted when paused, a bare track before it starts.
// Colours come through NativeWind's `text-*` as currentColor (price-chart.tsx).
import * as React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { cssInterop } from 'nativewind';
import { cn } from '@homeup/ui';

cssInterop(Svg, { className: { target: 'style', nativeStyleToProp: { color: true } } });

export type TimerRingTone = 'running' | 'paused' | 'done' | 'idle';

const TONE: Record<TimerRingTone, string> = {
  running: 'text-primary',
  paused: 'text-muted-foreground',
  done: 'text-destructive',
  idle: 'text-transparent',
};

export function TimerRing({ progress, tone, size = 36 }: { progress: number; tone: TimerRingTone; size?: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const p = tone === 'done' ? 1 : Math.min(1, Math.max(0, progress));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 36 36" className="absolute text-foreground/10">
        <Circle cx={18} cy={18} r={r} fill="none" strokeWidth={3} stroke="currentColor" />
      </Svg>
      <Svg width={size} height={size} viewBox="0 0 36 36" className={cn('absolute', TONE[tone])}>
        <Circle
          cx={18}
          cy={18}
          r={r}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          strokeDashoffset={c * (1 - p)}
          stroke="currentColor"
          transform="rotate(-90 18 18)"
        />
      </Svg>
    </View>
  );
}
