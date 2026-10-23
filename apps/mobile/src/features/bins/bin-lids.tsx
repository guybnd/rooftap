// Bin night: the small lid marks. Lid colours are content (the real bins),
// so they only ever paint these marks, never text, tiles or buttons.
// Web twin: apps/web/src/components/bin-lids.tsx.
import * as React from 'react';
import { View } from 'react-native';
import { binLidColor, type BinLid } from '@homeup/core';
import { cn } from '@homeup/ui';

export function BinLidMark({ lid, size = 'md' }: { lid: BinLid | string; size?: 'sm' | 'md' }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      className={cn('border border-foreground/25', size === 'sm' ? 'h-1.5 w-3 rounded-[2px]' : 'size-3.5 rounded')}
      style={{ backgroundColor: binLidColor(lid as BinLid) }}
    />
  );
}

export function BinLids({ lids, size = 'md', stacked = false, className }: { lids: readonly string[]; size?: 'sm' | 'md'; stacked?: boolean; className?: string }) {
  if (lids.length === 0) return null;
  return (
    <View className={cn('shrink-0 flex-row gap-1', stacked && 'flex-col gap-[3px]', className)}>
      {lids.map((lid, i) => (
        <BinLidMark key={`${lid}-${i}`} lid={lid} size={size} />
      ))}
    </View>
  );
}
