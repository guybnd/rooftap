// Rewards: a tappable suggestion chip (a scheme or store to add), padded to
// the 44px floor (M2) at about 36px visual height.
import * as React from 'react';
import { Pressable } from 'react-native';
import { X } from 'lucide-react-native';
import { Text, cn } from '@homeup/ui';

export function Chip({
  label,
  onPress,
  selected = false,
  onRemove,
}: {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  /** Shows an x that removes the chip. */
  onRemove?: () => void;
}) {
  return (
    <Pressable
      onPress={onRemove ?? onPress}
      accessibilityRole="button"
      accessibilityLabel={onRemove ? `Remove ${label}` : label}
      accessibilityState={{ selected }}
      hitSlop={4}
      className={cn(
        'min-h-9 flex-row items-center gap-1 rounded-full bg-muted px-3',
        selected && 'border border-primary',
        onRemove && 'pr-2',
      )}
    >
      <Text className={cn('text-[12.5px] font-medium', selected ? 'text-primary' : onRemove ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
      </Text>
      {onRemove && <X size={14} className="text-muted-foreground" />}
    </Pressable>
  );
}
