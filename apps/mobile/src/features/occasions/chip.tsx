// Occasions: a pick-one chip (who it's for, which occasion), padded to the
// 44px floor (M2) at about 36px visual height.
import * as React from 'react';
import { Pressable } from 'react-native';
import { Text, cn } from '@homeup/ui';

export function Chip({ label, onPress, selected = false }: { label: string; onPress: () => void; selected?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={4}
      className={cn('min-h-9 flex-row items-center rounded-full px-3', selected ? 'bg-primary' : 'bg-muted')}
    >
      <Text className={cn('text-[12.5px] font-medium', selected ? 'text-primary-foreground' : 'text-muted-foreground')}>{label}</Text>
    </Pressable>
  );
}

