// Hearth v2 (Pulse): Home's weather, beside the Hero — native twin of
// apps/web/src/app/home/sky.tsx. The sky block sits in the top right next to
// the count and opens the day ribbon under it: the next 12 hours as a
// rain-chance area under a temperature line, the current hour marked, a dot where a timed item falls
// and a sun line at sunset. Whether the ribbon is open is remembered per
// device (SecureStore, the same keyed-flag pattern as swipe-hint-card.tsx).
// Columns and the headline come from core (buildDayRibbon, skyHeadline).
//
// The rain area wears the sky section hue: the one place weather data shows a
// colour, signed off with the day ribbon design.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ChevronDown, CloudOff, MapPin } from 'lucide-react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { Text, haptics, useThemeMaterial, cn } from '@homeup/ui';
import { hueSchemeTone, hueSwatch, SKY_RIBBON_OPEN_STORAGE_KEY, describeDayRibbon, type RibbonHour, type WeatherData } from '@homeup/core';
import { iconAndLabelForCode } from './weather-icons';

/** Whether the day ribbon is open on this device. Starts collapsed. */
export function useSkyRibbonOpen(): [boolean, () => void] {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(SKY_RIBBON_OPEN_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && stored === '1') setOpen(true);
      })
      .catch(() => {
        // Unreadable: the ribbon just starts collapsed.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const toggle = React.useCallback(() => {
    haptics.tick();
    setOpen((prev) => {
      const next = !prev;
      void SecureStore.setItemAsync(SKY_RIBBON_OPEN_STORAGE_KEY, next ? '1' : '0').catch(() => {});
      return next;
    });
  }, []);
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
      <View className="flex-row items-center gap-2">
        <Icon size={20} className="text-warning" />
        <Text
          className="font-heading text-foreground"
          style={{ fontSize: 34, lineHeight: 36, fontWeight: '600', letterSpacing: -1, fontVariant: ['tabular-nums'] }}
        >
          {temp}°
        </Text>
      </View>
      <Text className="text-caption font-medium text-foreground">{headline}</Text>
      <View className="flex-row items-center gap-1">
        <Text className="font-mono text-[11px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {Math.round(weather.highC)}° / {Math.round(weather.lowC)}°
        </Text>
        {canExpand && (
          <ChevronDown size={14} className="text-muted-foreground" style={open ? { transform: [{ rotate: '180deg' }] } : undefined} />
        )}
      </View>
    </>
  );
  const className = 'min-w-[124px] shrink-0 items-end gap-1 rounded-[20px] bg-card/70 px-3.5 py-3';
  if (!canExpand) {
    return (
      <View className={className} accessible accessibilityLabel={`${temp} degrees, ${label}. ${headline}`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${temp} degrees, ${label}. ${headline}`}
      accessibilityHint={open ? 'Hides the hourly forecast' : 'Shows the hourly forecast'}
      className={cn(className, 'active:bg-card')}
    >
      {content}
    </Pressable>
  );
}

// The ribbon is one small chart, as on web (Guy, 2026-10-22: the old rounded
// bars read as blobs): rain chance as a soft area rising from the floor, the
// temperature as a thin line over it, each hour a column of the same width so
// the labels and marks above and below line up with the chart. Tapping an
// hour reads it out above the chart; tapping it again clears it.
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

export function DayRibbon({ hours }: { hours: RibbonHour[] }) {
  const material = useThemeMaterial();
  const hue = hueSwatch('sky', material.scheme);
  const dark = hueSchemeTone(material.scheme) === 'dark';
  const [width, setWidth] = React.useState(0);
  const [picked, setPicked] = React.useState<number | null>(null);
  const col = hours.length > 0 ? width / hours.length : 0;
  const xs = hours.map((_, i) => (i + 0.5) * col);
  const temps = hours.map((h) => h.tempC).filter((t): t is number => t !== null);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const tempY = (t: number) => (hi === lo ? (TEMP_TOP + TEMP_BOTTOM) / 2 : TEMP_BOTTOM - ((t - lo) / (hi - lo)) * (TEMP_BOTTOM - TEMP_TOP));
  const tempPoints = hours.flatMap((h, i): [number, number][] => (h.tempC === null ? [] : [[xs[i], tempY(h.tempC)]]));
  const rainPoints = hours.map((h, i): [number, number] => [xs[i], CHART_H - (h.precipitationProbability / 100) * RAIN_MAX]);
  const rainLine =
    rainPoints.length > 0 ? smoothPath([[0, rainPoints[0][1]], ...rainPoints, [width, rainPoints[rainPoints.length - 1][1]]]) : '';
  const rainArea = `${rainLine} L${width},${CHART_H} L0,${CHART_H} Z`;
  const anyRain = hours.some((h) => h.precipitationProbability > 0);
  const at = picked != null ? hours[picked] : null;
  const pick = (i: number) => {
    haptics.tick();
    setPicked((p) => (p === i ? null : i));
  };

  return (
    <View>
      <View className="mb-1.5 h-4 flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
        {at ? <HourReadout hour={at} rainColor={hue.glyph} /> : <RibbonKey rain={anyRain} rainColor={hue.glow} />}
      </View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityLabel={describeDayRibbon(hours)}>
        <View className="flex-row">
          {hours.map((h) => (
            <Text key={h.key} className="h-3.5 flex-1 text-center font-mono text-[10px] leading-3 text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {h.showTemp ? `${h.tempC}°` : ''}
            </Text>
          ))}
        </View>
        <View style={{ height: CHART_H }}>
          {width > 0 && (
            <>
              {/* Now: a hairline through the first hour. */}
              <View className="absolute bottom-0 top-0 w-px bg-primary/70" style={{ left: xs[0] }} />
              {/* The picked hour: a soft column behind the chart. */}
              {picked != null && <View className="absolute bottom-0 top-0 rounded-md bg-foreground/[0.07]" style={{ left: picked * col, width: col }} />}
              <Svg width={width} height={CHART_H}>
                <Defs>
                  <LinearGradient id="ribbon-rain" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={hue.glow} stopOpacity={0.55} />
                    <Stop offset="1" stopColor={hue.glow} stopOpacity={0.08} />
                  </LinearGradient>
                </Defs>
                <Line x1={0} x2={width} y1={CHART_H - 0.5} y2={CHART_H - 0.5} stroke={dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'} strokeWidth={1} />
                {anyRain && (
                  <>
                    <Path d={rainArea} fill="url(#ribbon-rain)" />
                    <Path d={rainLine} fill="none" stroke={hue.glow} strokeOpacity={0.9} strokeWidth={1.5} />
                  </>
                )}
                {tempPoints.length > 1 && (
                  <Path
                    d={smoothPath(tempPoints)}
                    fill="none"
                    stroke={dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)'}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />
                )}
              </Svg>
            </>
          )}
        </View>
        <View className="mt-1.5 flex-row">
          {hours.map((h, i) => (
            <Pressable
              key={h.key}
              onPress={() => pick(i)}
              accessibilityRole="button"
              accessibilityLabel={hourSentence(h)}
              accessibilityState={{ selected: picked === i }}
              className="flex-1 items-center gap-1 py-0.5"
            >
              <View className="h-1.5 items-center justify-center">
                {h.hasItem ? (
                  <View className="h-1.5 w-1.5 rounded-full bg-foreground" />
                ) : h.isSunset ? (
                  <View className="h-0.5 w-2.5 rounded-full bg-warning" />
                ) : null}
              </View>
              <Text
                className={cn(
                  'font-mono text-[10px]',
                  h.isNow || picked === i
                    ? 'font-semibold text-primary'
                    : h.dayStart
                      ? 'font-semibold text-foreground'
                      : h.isSunset
                        ? 'text-warning'
                        : 'text-muted-foreground',
                )}
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {h.dayStart ?? h.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {/* The chart itself answers a tap too: the hour under the finger. */}
        {width > 0 && (
          <Pressable
            accessible={false}
            className="absolute left-0 right-0"
            style={{ top: 14, height: CHART_H }}
            onPress={(e) => pick(Math.max(0, Math.min(hours.length - 1, Math.floor(e.nativeEvent.locationX / col))))}
          />
        )}
      </View>
    </View>
  );
}

function hourSentence(h: RibbonHour): string {
  const parts = [h.fullLabel];
  if (h.tempC !== null) parts.push(`${h.tempC} degrees`);
  parts.push(`${h.precipitationProbability}% chance of rain`);
  if (h.weatherCode !== null) parts.push(iconAndLabelForCode(h.weatherCode).label);
  return parts.join(', ');
}

function HourReadout({ hour, rainColor }: { hour: RibbonHour; rainColor: string }) {
  const condition = hour.weatherCode !== null ? iconAndLabelForCode(hour.weatherCode) : null;
  const mono = { fontVariant: ['tabular-nums' as const] };
  return (
    <>
      <Text className="font-mono text-[11px] font-semibold text-foreground" style={mono}>
        {hour.fullLabel}
      </Text>
      {condition && <condition.Icon size={14} className="text-foreground/70" />}
      {hour.tempC !== null && (
        <Text className="font-mono text-[11px] text-foreground" style={mono}>
          {hour.tempC}°
        </Text>
      )}
      <Text className="font-mono text-[11px] text-muted-foreground">·</Text>
      <Text className="font-mono text-[11px]" style={[mono, { color: rainColor }]}>
        {hour.precipitationProbability}% rain
      </Text>
      {condition && (
        <>
          <Text className="font-mono text-[11px] text-muted-foreground">·</Text>
          <Text numberOfLines={1} className="shrink text-[11px] text-muted-foreground">
            {condition.label}
          </Text>
        </>
      )}
    </>
  );
}

function RibbonKey({ rain, rainColor }: { rain: boolean; rainColor: string }) {
  return (
    <>
      <View className="h-0.5 w-3 rounded-full bg-foreground/55" />
      <Text className="text-[11px] text-muted-foreground">Temperature</Text>
      {rain && (
        <>
          <View className="ml-2 h-2 w-3 rounded-sm" style={{ backgroundColor: rainColor, opacity: 0.6 }} />
          <Text className="text-[11px] text-muted-foreground">Chance of rain</Text>
        </>
      )}
      <View className="flex-1" />
      <Text className="text-[11px] text-muted-foreground">Tap an hour for details</Text>
    </>
  );
}

/**
 * What the sky block's spot says when weather is on but there is none to
 * show: no home location to ask about, or the forecast didn't load. Without
 * it the block just vanished and the toggle looked broken.
 */
export function SkyNote({ reason, onSetLocation }: { reason: 'noLocation' | 'unavailable'; onSetLocation: () => void }) {
  const className = 'max-w-[150px] shrink-0 items-end gap-1 rounded-[20px] bg-card/70 px-3.5 py-3';
  if (reason === 'unavailable') {
    return (
      <View className={className} accessible accessibilityLabel="Weather couldn't load">
        <CloudOff size={20} className="text-muted-foreground" />
        <Text className="text-right text-caption text-muted-foreground">Weather couldn't load</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onSetLocation}
      accessibilityRole="button"
      accessibilityLabel="Add your home address to see weather"
      className={cn(className, 'active:bg-card')}
    >
      <MapPin size={20} className="text-primary" />
      <Text className="text-right text-caption font-medium text-primary">Add your home address for weather</Text>
    </Pressable>
  );
}
