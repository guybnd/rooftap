'use client';

// Hearth v2 (Pulse): Home's weather, beside the Hero. The sky block sits in
// the top right next to the count and opens the day ribbon under it: the
// next 12 hours as rain-chance bars, the current hour marked, a dot where a
// timed item falls and a sun line at sunset. Whether the ribbon is open is
// remembered per device. The mobile twin is apps/mobile features/home/sky.tsx;
// the ribbon's columns and headline come from core (buildDayRibbon,
// skyHeadline).
//
// The rain bars wear the sky section hue: the one place weather data shows a
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

/** Bar height in px for a rain chance; never zero so an empty hour still reads as a slot. */
function barHeight(probability: number): number {
  return Math.max(3, Math.round(probability * 0.4));
}

export function DayRibbon({ hours }: { hours: RibbonHour[] }) {
  return (
    <div
      id="home-day-ribbon"
      role="img"
      aria-label={describeDayRibbon(hours)}
      data-hue="sky"
      className="flex items-end gap-1"
    >
      {hours.map((h) => (
        <div key={h.key} aria-hidden className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <span className="h-3 font-mono text-[10px] leading-3 text-muted-foreground tabular-nums">
            {h.showTemp ? `${h.tempC}°` : ''}
          </span>
          <span className="flex h-2 items-center justify-center">
            {h.hasItem ? (
              <span className="size-1.5 rounded-full bg-foreground" />
            ) : h.isSunset ? (
              <span className="h-0.5 w-2.5 rounded-full bg-warning" />
            ) : null}
          </span>
          <span
            className={cn(
              'flex h-10 w-full items-end overflow-hidden rounded-md bg-muted/60',
              h.isNow && 'ring-[1.5px] ring-inset ring-primary',
            )}
          >
            <span
              className={cn('w-full rounded-[3px] bg-[var(--hue-glow)]', !h.rainLikely && 'opacity-35')}
              style={{ height: barHeight(h.precipitationProbability) }}
            />
          </span>
          <span
            className={cn(
              'font-mono text-[10px] tabular-nums',
              h.isNow ? 'font-semibold text-primary' : h.isSunset ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {h.label}
          </span>
        </div>
      ))}
    </div>
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
