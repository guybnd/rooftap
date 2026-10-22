'use client';

// Hearth v2 (Pulse): Home's weather, beside the Hero. The sky block sits in
// the top right next to the count and opens the day ribbon under it: the
// next 12 hours (48 on a wide screen, scrolling) as a rain-chance area under
// a temperature line, the current hour marked, a dot where a timed item falls
// and a sun line at sunset. Pointing at or clicking an hour reads it out
// above the chart: time, temperature, rain chance and sky. Whether it is open is
// remembered per device. The mobile twin is apps/mobile features/home/sky.tsx;
// the ribbon's columns and headline come from core (buildDayRibbon,
// skyHeadline).
//
// The rain area wears the sky section hue: the one place weather data shows a
// colour, signed off with the day ribbon design.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, CloudOff, MapPin } from 'lucide-react';
import type { RibbonHour } from '@homeup/core';
import { SKY_RIBBON_OPEN_STORAGE_KEY, describeDayRibbon } from '@homeup/core';
import { cn } from '@/lib/utils';
import { iconAndLabelForCode, type WeatherData } from './use-weather';

/** Whether the day ribbon is open on this device. Starts collapsed. */
export function useSkyRibbonOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(SKY_RIBBON_OPEN_STORAGE_KEY) === '1');
    } catch {
      // Storage blocked: the ribbon just starts collapsed.
    }
  }, []);
  const toggle = () =>
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SKY_RIBBON_OPEN_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Not persisted; the toggle still works for this visit.
      }
      return next;
    });
  return [open, toggle];
}

export function SkyBlock({
  weather,
  headline,
  open,
  onToggle,
  canExpand,
}: {
  weather: WeatherData;
  headline: string;
  open: boolean;
  onToggle: () => void;
  /** False when the payload has no hourly series to show. */
  canExpand: boolean;
}) {
  const { Icon, label } = iconAndLabelForCode(weather.weatherCode);
  const temp = Math.round(weather.tempC);
  const content = (
    <>
      <span className="flex items-center gap-2">
        <Icon className="size-5 text-warning" aria-hidden />
        <span className="font-heading text-[34px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground">{temp}°</span>
      </span>
      <span className="text-[13px] font-medium text-foreground">{headline}</span>
      <span className="flex items-center gap-1">
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {Math.round(weather.highC)}° / {Math.round(weather.lowC)}°
        </span>
        {canExpand && (
          <ChevronDown
            aria-hidden
            className={cn('size-3.5 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
          />
        )}
      </span>
    </>
  );
  const className = 'flex min-w-[124px] shrink-0 flex-col items-end gap-1 rounded-[20px] bg-card/70 px-3.5 py-3 text-right';
  if (!canExpand) {
    return (
      <div role="group" aria-label={`${temp} degrees, ${label}. ${headline}`} className={className}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="home-day-ribbon"
      aria-label={`${temp} degrees, ${label}. ${headline}. ${open ? 'Hide' : 'Show'} the hourly forecast`}
      className={cn(className, 'transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
    >
      {content}
    </button>
  );
}

// The ribbon is one small chart (Guy, 2026-10-22: the old rounded bars read
// as blobs): rain chance as a soft area rising from the floor, the
// temperature as a thin line over it, each hour a column of the same width
// so the labels, dots and marks above and below line up with the chart.
const COL = 40;
const CHART_H = 44;
/** The temperature line keeps to the top band; rain fills up from the floor. */
const TEMP_TOP = 6;
const TEMP_BOTTOM = 20;
const RAIN_MAX = CHART_H - 6;

/** A smooth path through points (Catmull-Rom as cubic Béziers). */
function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return '';
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function DayRibbon({ hours, scroll = false }: { hours: RibbonHour[]; scroll?: boolean }) {
  // Pointing at an hour (or clicking it, which keeps it) reads that hour out
  // above the chart; with nothing picked the line says what the marks mean.
  const [pinned, setPinned] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const picked = hovered ?? pinned;
  const width = hours.length * COL;
  const xs = hours.map((_, i) => (i + 0.5) * COL);
  const temps = hours.map((h) => h.tempC).filter((t): t is number => t !== null);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const tempY = (t: number) => (hi === lo ? (TEMP_TOP + TEMP_BOTTOM) / 2 : TEMP_BOTTOM - ((t - lo) / (hi - lo)) * (TEMP_BOTTOM - TEMP_TOP));
  const tempPoints = hours.flatMap((h, i): [number, number][] => (h.tempC === null ? [] : [[xs[i], tempY(h.tempC)]]));
  const rainPoints = hours.map((h, i): [number, number] => [xs[i], CHART_H - (h.precipitationProbability / 100) * RAIN_MAX]);
  // The area runs edge to edge: it starts and ends at the first and last hour's level.
  const rainLine = smoothPath([[0, rainPoints[0][1]], ...rainPoints, [width, rainPoints[rainPoints.length - 1][1]]]);
  const rainArea = `${rainLine} L${width},${CHART_H} L0,${CHART_H} Z`;
  const anyRain = hours.some((h) => h.precipitationProbability > 0);
  // A scrolling ribbon gives every hour a fixed width; a fitted one shares the row.
  const cols = { gridTemplateColumns: scroll ? `repeat(${hours.length}, ${SCROLL_COL_PX}px)` : `repeat(${hours.length}, minmax(0, 1fr))` };
  const track = scroll ? { width: hours.length * SCROLL_COL_PX } : undefined;
  const at = picked != null ? hours[picked] : null;
  const hourAt = (e: { clientX: number; currentTarget: HTMLElement }) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(hours.length - 1, Math.floor(((e.clientX - box.left) / box.width) * hours.length)));
  };

  return (
    <div id="home-day-ribbon" data-hue="sky" className="relative">
      <p aria-live="polite" className="mb-1.5 flex h-4 items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
        {at ? <HourReadout hour={at} /> : <RibbonKey rain={anyRain} />}
      </p>
      <div className={cn(scroll && 'scroll-quiet -mx-1 overflow-x-auto overscroll-x-contain px-1 pb-1')}>
        {/* The whole hour column answers the pointer, not only its label;
            the label buttons stay for keyboard and screen readers. */}
        <div
          role="group"
          aria-label={describeDayRibbon(hours)}
          className="relative cursor-pointer"
          style={track}
          onPointerMove={(e) => e.pointerType === 'mouse' && setHovered(hourAt(e))}
          onPointerLeave={() => setHovered(null)}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            const i = hourAt(e);
            setPinned((p) => (p === i ? null : i));
          }}
        >
          <div aria-hidden className="grid" style={cols}>
            {hours.map((h) => (
              <span key={h.key} className="h-3.5 text-center font-mono text-[10px] leading-3 text-muted-foreground tabular-nums">
                {h.showTemp ? `${h.tempC}°` : ''}
              </span>
            ))}
          </div>
          <div aria-hidden className="relative">
            {/* Now: a hairline through the first hour. */}
            <span className="absolute inset-y-0 w-px -translate-x-1/2 bg-primary/70" style={{ left: `${50 / hours.length}%` }} />
            {/* The picked hour: a soft column behind the chart. */}
            {picked != null && (
              <span
                className="absolute inset-y-0 rounded-md bg-foreground/[0.07]"
                style={{ left: `${(picked / hours.length) * 100}%`, width: `${100 / hours.length}%` }}
              />
            )}
            <svg viewBox={`0 0 ${width} ${CHART_H}`} preserveAspectRatio="none" className="relative block h-11 w-full overflow-visible">
              <defs>
                <linearGradient id="ribbon-rain" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--hue-glow)" stopOpacity="0.55" />
                  <stop offset="1" stopColor="var(--hue-glow)" stopOpacity="0.08" />
                </linearGradient>
              </defs>
              <line x1="0" x2={width} y1={CHART_H - 0.5} y2={CHART_H - 0.5} stroke="currentColor" className="text-border" vectorEffect="non-scaling-stroke" />
              {anyRain && (
                <>
                  <path d={rainArea} fill="url(#ribbon-rain)" />
                  <path d={rainLine} fill="none" stroke="var(--hue-glow)" strokeOpacity="0.9" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                </>
              )}
              {tempPoints.length > 1 && (
                <path
                  d={smoothPath(tempPoints)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  className="text-foreground/55"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          </div>
          <div className="mt-1.5 grid" style={cols}>
            {hours.map((h, i) => (
              <button
                key={h.key}
                type="button"
                aria-label={hourSentence(h)}
                aria-pressed={pinned === i}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                onClick={() => setPinned((p) => (p === i ? null : i))}
                className="flex flex-col items-center gap-1 rounded-md py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-1.5 items-center justify-center">
                  {h.hasItem ? (
                    <span className="size-1.5 rounded-full bg-foreground" />
                  ) : h.isSunset ? (
                    <span className="h-0.5 w-2.5 rounded-full bg-warning" />
                  ) : null}
                </span>
                <span
                  className={cn(
                    'font-mono text-[10px] tabular-nums',
                    h.isNow || pinned === i ? 'font-semibold text-primary' : h.dayStart ? 'font-semibold text-foreground' : h.isSunset ? 'text-warning' : 'text-muted-foreground',
                  )}
                >
                  {h.dayStart ?? h.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Each hour's width on a scrolling ribbon (px). */
const SCROLL_COL_PX = 40;

function hourSentence(h: RibbonHour): string {
  const parts = [h.fullLabel];
  if (h.tempC !== null) parts.push(`${h.tempC} degrees`);
  parts.push(`${h.precipitationProbability}% chance of rain`);
  if (h.weatherCode !== null) parts.push(iconAndLabelForCode(h.weatherCode).label);
  return parts.join(', ');
}

function HourReadout({ hour }: { hour: RibbonHour }) {
  const condition = hour.weatherCode !== null ? iconAndLabelForCode(hour.weatherCode) : null;
  return (
    <>
      <span className="font-semibold text-foreground">{hour.fullLabel}</span>
      {condition && <condition.Icon aria-hidden className="size-3.5 text-foreground/70" />}
      {hour.tempC !== null && <span className="text-foreground">{hour.tempC}°</span>}
      <span>·</span>
      <span className="text-[var(--hue-glyph)]">{hour.precipitationProbability}% rain</span>
      {condition && (
        <>
          <span>·</span>
          <span className="font-sans">{condition.label}</span>
        </>
      )}
    </>
  );
}

function RibbonKey({ rain }: { rain: boolean }) {
  return (
    <>
      <span aria-hidden className="h-0.5 w-3 rounded-full bg-foreground/55" />
      <span className="font-sans">Temperature</span>
      {rain && (
        <>
          <span aria-hidden className="ml-2 h-2 w-3 rounded-sm bg-[var(--hue-glow)] opacity-60" />
          <span className="font-sans">Chance of rain</span>
        </>
      )}
      <span className="ml-auto font-sans">Point at an hour for details</span>
    </>
  );
}

/**
 * What the sky block's spot says when weather is on but there is none to
 * show: no home location to ask about, or the forecast didn't load. Without
 * it the block just vanished and the toggle looked broken.
 */
export function SkyNote({ reason }: { reason: 'noLocation' | 'unavailable' }) {
  const className = 'flex max-w-[160px] shrink-0 flex-col items-end gap-1 rounded-[20px] bg-card/70 px-3.5 py-3 text-right text-[13px]';
  if (reason === 'unavailable') {
    return (
      <div role="status" className={cn(className, 'text-muted-foreground')}>
        <CloudOff className="size-5" aria-hidden />
        <span>Weather couldn&apos;t load</span>
      </div>
    );
  }
  return (
    <Link href="/settings/global" className={cn(className, 'font-medium text-primary hover:bg-card')}>
      <MapPin className="size-5" aria-hidden />
      <span>Add your home address for weather</span>
    </Link>
  );
}
