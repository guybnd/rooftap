// Rewards: a card drawn in its scheme's colour. The colour is content (like a
// grocery glyph), never chrome, so it stays inside the face. Web twin:
// apps/web/src/app/rewards/card-face.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@homeup/ui';

/** The wallet face: scheme name, who holds it, and one line of facts. */
export function CardFace({
  color,
  title,
  holder,
  detail,
  onPress,
}: {
  color: string;
  title: string;
  holder: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${holder}`}
      style={{ backgroundColor: color, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: -3 }, elevation: 3 }}
      className="min-h-[88px] justify-between gap-3 rounded-[20px] p-4 active:opacity-90"
    >
      <View className="flex-row items-start justify-between gap-3">
        <Text numberOfLines={2} className="shrink font-heading text-base font-bold leading-tight text-white">
          {title}
        </Text>
        <Text className="shrink-0 text-xs font-medium text-white/85">{holder}</Text>
      </View>
      {!!detail && (
        <Text numberOfLines={1} className="text-xs font-medium text-white/85">
          {detail}
        </Text>
      )}
    </Pressable>
  );
}

/** The small face in a row's leading slot. */
export function MiniFace({ color }: { color: string }) {
  return (
    <View style={{ backgroundColor: color }} className="h-6 w-9 shrink-0 rounded-md">
      <View className="absolute bottom-1.5 left-1.5 h-[3px] w-3 rounded-sm bg-white/70" />
    </View>
  );
}
