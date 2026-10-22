// The foot of a Now card that can't be finished (an event or a viewing),
// where a to-do has its slide track: where it is and when it ends, then Open
// and Directions. Web twin: EventCardFooter in apps/web/src/app/home/summary-hero.tsx.
import * as React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { ArrowUpRight, MapPin, Navigation } from 'lucide-react-native';
import { Text, haptics } from '@homeup/ui';
import { formatTime12h, heroItemEventDetails, mapsDirectionsUrl, type HeroItem } from '@homeup/core';

export function EventCardFooter({ item, onOpen }: { item: HeroItem; onOpen?: () => void }) {
  const { location, endsAt, travelMode } = heroItemEventDetails(item);
  // A viewing's place is already its title.
  const place = item.appointment ? null : location;
  if (!onOpen && !location) return null;
  return (
    <View className="gap-3">
      {(place || endsAt) && (
        <View className="min-w-0 flex-row items-center gap-1.5">
          {place && <MapPin size={16} className="text-muted-foreground" />}
          <Text numberOfLines={1} className="shrink text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {place}
            {place && endsAt ? ' · ' : ''}
            {endsAt ? `Until ${formatTime12h(endsAt)}` : ''}
          </Text>
        </View>
      )}
      <View className="flex-row flex-wrap gap-2">
        {onOpen && <Pill label="Open" Icon={ArrowUpRight} onPress={onOpen} />}
        {location && (
          <Pill
            label="Directions"
            Icon={Navigation}
            onPress={() => void Linking.openURL(mapsDirectionsUrl(location, travelMode)).catch(() => {})}
          />
        )}
      </View>
    </View>
  );
}

function Pill({ label, Icon, onPress }: { label: string; Icon: typeof MapPin; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-10 flex-row items-center gap-2 rounded-full bg-muted px-4 active:opacity-80"
    >
      <Icon size={16} className="text-foreground" />
      <Text className="text-body font-medium text-foreground">{label}</Text>
    </Pressable>
  );
}
