// HOUP-434: Shopper's two price drawings. The sparkline is a row's 52px trend
// (H3: a meter-sized readout scoped to its row); the chart is the detail
// screen's history card. Both draw the daily lows from core dailyLows(), in
// the foreground ink with today's point in the deal's status hue. The Svg is
// wired into NativeWind so a `text-*` class sets its `color`, which the
// marks read as currentColor (the same tone classes web uses).
// Web twin: apps/web/src/app/shopper/price-chart.tsx.
import * as React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Polyline, Rect } from 'react-native-svg';
import { cssInterop } from 'nativewind';
import { Text } from '@homeup/ui';
import { formatMoney, type DailyPrice, type DealRating } from '@homeup/core';

cssInterop(Svg, { className: { target: 'style', nativeStyleToProp: { color: true } } });
cssInterop(G, { className: { target: false, nativeStyleToProp: { color: true } } });

export function dealToneClass(rating: DealRating | null): string {
  if (rating === 'great' || rating === 'good') return 'text-success';
  if (rating === 'wait') return 'text-warning';
  return 'text-muted-foreground';
}

function scale(series: readonly DailyPrice[], width: number, height: number, pad: number) {
  const values = series.map((p) => p.cents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (series.length === 1 ? width - pad : pad + (i / (series.length - 1)) * (width - pad * 2));
  const y = (cents: number) => pad + (1 - (cents - min) / span) * (height - pad * 2);
  return { x, y, min, max };
}

/** 52 x 18 trend for a row; nothing for fewer than two days. */
export function Sparkline({ series, rating }: { series: readonly DailyPrice[]; rating: DealRating | null }) {
  if (series.length < 2) return null;
  const { x, y } = scale(series, 52, 18, 2);
  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  return (
    <Svg width={52} height={18} viewBox="0 0 52 18" className={dealToneClass(rating)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
      <Circle cx={x(series.length - 1)} cy={y(last.cents)} r={2} fill="currentColor" />
    </Svg>
  );
}

/** The history card's chart: the usual band, the daily lows, today's point. */
export function PriceChart({
  series,
  usual,
  rating,
  currency,
}: {
  series: readonly DailyPrice[];
  usual: { from: number; to: number } | null;
  rating: DealRating | null;
  currency: string;
}) {
  const [width, setWidth] = React.useState(0);
  const H = 120;
  const PAD = 8;
  if (series.length < 2) {
    return <Text className="py-6 text-center text-sm text-muted-foreground">The chart fills in as prices are checked each day.</Text>;
  }
  const W = width || 320;
  // Keep the usual band inside the scale so it is always drawn to the same axis.
  const withBand = usual ? [...series, { day: '', cents: usual.from }, { day: '', cents: usual.to }] : series;
  const { y, min, max } = scale(withBand, W, H, PAD);
  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  const label = `Price over ${series.length} days, from ${formatMoney(min, { currency })} to ${formatMoney(max, { currency })}, now ${formatMoney(last.cents, { currency })}`;
  return (
    <View className="gap-1.5">
      <View
        onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        style={{ height: H }}
      >
        {width > 0 && (
          <Svg width={W} height={H} className="text-foreground">
            {usual && (
              <Rect
                x={0}
                y={y(usual.to)}
                width={W}
                height={Math.max(2, y(usual.from) - y(usual.to))}
                fill="currentColor"
                fillOpacity={0.07}
              />
            )}
            <Polyline points={points} fill="none" stroke="currentColor" strokeOpacity={0.75} strokeWidth={2} strokeLinejoin="round" />
            <G className={dealToneClass(rating)}>
              <Circle cx={x(series.length - 1)} cy={y(last.cents)} r={4.5} fill="currentColor" />
            </G>
          </Svg>
        )}
      </View>
      <View className="flex-row justify-between">
        <Text className="font-mono text-[11.5px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {shortDay(series[0].day)}
        </Text>
        {usual && (
          <Text className="font-mono text-[11.5px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            usual {formatMoney(usual.from, { currency })} to {formatMoney(usual.to, { currency })}
          </Text>
        )}
        <Text className="font-mono text-[11.5px] text-muted-foreground">today</Text>
      </View>
    </View>
  );
}

function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
