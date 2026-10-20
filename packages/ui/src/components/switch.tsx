// HOUP-327: universal Switch primitive, promoted from the summary-hero
// customize sheet's page-local `HeroModuleToggle` (apps/mobile/src/features/
// home/hero-customize-sheet.tsx) — same visual/behavioral contract, now
// shared by any screen that needs an on/off row (the hero sheet re-imports
// this instead of keeping its own copy).
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { cn } from '../lib/cn';
import { select } from '../lib/haptics';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

/** Flipping fires select() itself (Hearth §9), so callers never add their own pulse. */
export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        select();
        onChange(!checked);
      }}
      className={cn(
        'h-5 w-9 shrink-0 justify-center rounded-full',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
        disabled && 'opacity-50',
        className,
      )}
    >
      <View className={cn('h-4 w-4 rounded-full bg-white shadow', checked ? 'ml-[18px]' : 'ml-0.5')} />
    </Pressable>
  );
}
