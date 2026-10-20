// Hearth v2 (Pulse): Home's weather, beside the Hero — native twin of
// apps/web/src/app/home/sky.tsx. The sky block sits in the top right next to
// the count and opens the day ribbon under it: the next 12 hours as
// rain-chance bars, the current hour marked, a dot where a timed item falls
// and a sun line at sunset. Whether the ribbon is open is remembered per
// device (SecureStore, the same keyed-flag pattern as swipe-hint-card.tsx).
// Columns and the headline come from core (buildDayRibbon, skyHeadline).
//
// The rain bars wear the sky section hue: the one place weather data shows a
// colour, signed off with the day ribbon design.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ChevronDown, CloudOff, MapPin } from 'lucide-react-native';
import { Text, haptics, useThemeMaterial, cn } from '@homeup/ui';
import { SECTION_HUES, SKY_RIBBON_OPEN_STORAGE_KEY, describeDayRibbon, type RibbonHour, type WeatherData } from '@homeup/core';
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

/** Bar height for a rain chance; never zero so an empty hour still reads as a slot. */
function barHeight(probability: number): number {
  return Math.max(3, Math.round(probability * 0.4));
}

export function DayRibbon({ hours }: { hours: RibbonHour[] }) {
  const material = useThemeMaterial();
  const rain = SECTION_HUES.sky[material.scheme].glow;
  return (
    <View className="flex-row items-end gap-1" accessible accessibilityRole="image" accessibilityLabel={describeDayRibbon(hours)}>
      {hours.map((h) => (
        <View key={h.key} className="min-w-0 flex-1 items-center gap-1.5">
          <Text className="h-3 font-mono text-[10px] leading-3 text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {h.showTemp ? `${h.tempC}°` : ''}
          </Text>
          <View className="h-2 items-center justify-center">
            {h.hasItem ? (
              <View className="h-1.5 w-1.5 rounded-full bg-foreground" />
            ) : h.isSunset ? (
              <View className="h-0.5 w-2.5 rounded-full bg-warning" />
            ) : null}
          </View>
          <View
            className={cn('h-10 w-full justify-end overflow-hidden rounded-md bg-muted/60', h.isNow && 'border-[1.5px] border-primary')}
          >
            <View
              className="w-full rounded-[3px]"
              style={{ height: barHeight(h.precipitationProbability), backgroundColor: rain, opacity: h.rainLikely ? 1 : 0.35 }}
            />
          </View>
          <Text
            className={cn(
              'font-mono text-[10px]',
              h.isNow ? 'font-semibold text-primary' : h.isSunset ? 'text-warning' : 'text-muted-foreground',
            )}
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {h.label}
          </Text>
        </View>
      ))}
    </View>
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
