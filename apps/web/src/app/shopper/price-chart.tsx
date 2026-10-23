'use client';

// HOUP-434: Shopper's two price drawings. The sparkline is a row's 52px trend
// (H3: a meter-sized readout scoped to its row); the chart is the detail
// screen's history card. Both draw the daily lows from core dailyLows(), in
// the foreground ink with today's point in the deal's status hue.
// Native twin: apps/mobile/src/features/shopper/price-chart.tsx.
import { formatMoney, priceChartScale, priceDayLabel, type DailyPrice, type DealRating } from '@homeup/core';

const TONE_CLASS: Record<'success' | 'muted' | 'warning', string> = {
  success: 'text-success',
  muted: 'text-muted-foreground',
  warning: 'text-warning',
};

export function dealToneClass(rating: DealRating | null): string {
  if (rating === 'great' || rating === 'good') return TONE_CLASS.success;
  if (rating === 'wait') return TONE_CLASS.warning;
  return TONE_CLASS.muted;
}

/** 52 x 18 trend for a row; nothing for fewer than two days. */
export function Sparkline({ series, rating }: { series: readonly DailyPrice[]; rating: DealRating | null }) {
  if (series.length < 2) return null;
  const { x, y } = priceChartScale(series, 52, 18, 2);
  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  return (
    <svg viewBox="0 0 52 18" width={52} height={18} aria-hidden className={dealToneClass(rating)}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={x(series.length - 1)} cy={y(last.cents)} r={2} fill="currentColor" />
    </svg>
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
  const W = 320;
  const H = 120;
  const PAD = 8;
  if (series.length < 2) {
    return <p className="py-6 text-center text-sm text-muted-foreground">The chart fills in as prices are checked each day.</p>;
  }
  // Keep the usual band inside the scale so it is always drawn to the same axis.
  const withBand = usual ? [...series, { day: '', cents: usual.from }, { day: '', cents: usual.to }] : series;
  const { y, min, max } = priceChartScale(withBand, W, H, PAD);
  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  const label = `Price over ${series.length} days, from ${formatMoney(min, { currency })} to ${formatMoney(max, { currency })}, now ${formatMoney(last.cents, { currency })}`;
  return (
    <figure className="m-0 space-y-1.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label}>
        {usual && (
          <rect x={0} y={y(usual.to)} width={W} height={Math.max(2, y(usual.from) - y(usual.to))} className="fill-foreground/[0.07]" />
        )}
        <polyline
          points={points}
          fill="none"
          className="stroke-foreground/75"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <circle cx={x(series.length - 1)} cy={y(last.cents)} r={4.5} className={dealToneClass(rating)} fill="currentColor" />
      </svg>
      <figcaption className="flex justify-between font-mono text-[11.5px] text-muted-foreground tabular-nums">
        <span>{priceDayLabel(series[0].day)}</span>
        {usual && (
          <span>
            usual {formatMoney(usual.from, { currency })} to {formatMoney(usual.to, { currency })}
          </span>
        )}
        <span>today</span>
      </figcaption>
    </figure>
  );
}
