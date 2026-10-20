// HOUP-68: native port of apps/web/src/components/ui/segmented-control.tsx
// (M2: segment sizing). `role="radiogroup"`/`role="radio"` become RN
// accessibility props; hover states are dropped (no pointer on touch).
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { cn } from '../lib/cn';
import { select } from '../lib/haptics';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Let segments wrap to a second line (for many options, e.g. cadence). */
  wrap?: boolean;
  /** HOUP-173: size the control (and its segments) to their content instead
   * of stretching to fill the row — for placing several compact controls
   * side by side (e.g. tasks' All/Mine + Date/Person filters sharing one
   * line). Unlike `wrap`, the container itself never wraps to a second
   * line — reserve this for controls with few, short-label options that
   * always fit on one line. */
  fitContent?: boolean;
  size?: 'sm' | 'md';
  /** HOUP-172: render each segment's `icon` only, dropping the text label — for
   * tight spots (e.g. a type filter beside a count line) where a labeled
   * control would overflow its container's `overflow-hidden` edge. The full
   * label still reaches assistive tech via each segment's own accessibility
   * label. Requires every option to pass `icon`. */
  iconOnly?: boolean;
  accessibilityLabel?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  wrap = false,
  fitContent = false,
  size = 'md',
  iconOnly = false,
  accessibilityLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      className={cn(
        'flex-row gap-1 rounded-lg border border-border bg-muted/40 p-1',
        wrap && 'flex-wrap',
        fitContent && 'self-start',
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) select();
              onChange(opt.value);
            }}
            className={cn(
              'flex-row items-center justify-center gap-1.5 rounded-md',
              wrap || fitContent ? 'flex-none' : 'flex-1',
              size === 'sm' ? 'px-2 py-1' : 'px-3 py-1.5',
              active && 'bg-background shadow-sm border border-border'
            )}
          >
            {opt.icon}
            {!iconOnly && (
              <Text
                className={cn(
                  'font-medium',
                  size === 'sm' ? 'text-xs' : 'text-sm',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {opt.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
