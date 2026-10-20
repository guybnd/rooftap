// HOUP-68: native port of apps/web/src/components/ui/pill.tsx.
import * as React from 'react';
import { Platform, Text, View, type TextProps, type ViewProps } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const pillVariants = cva('w-fit shrink-0 flex-row items-center gap-1 rounded-full border px-2', {
  variants: {
    variant: {
      default: 'border-transparent bg-secondary',
      outline: 'border-border bg-transparent',
      primary: 'border-transparent bg-primary/15',
      muted: 'border-transparent bg-muted',
      destructive: 'border-transparent bg-destructive/15',
    },
    size: {
      default: 'py-0.5',
      sm: 'px-1.5 py-px',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

const pillTextStyle = Platform.OS === 'android' ? { includeFontPadding: false } : undefined;

// HOUP-297: explicit line height, NOT `leading-none`. The native pill has no
// fixed height (unlike web's `h-5` + flex centering), so the pill's height IS
// the Text line box — with line-height == font-size Android clips descenders
// ("Comments"/"In progress"/"one-off" bottom-clipped in both Axis themes).
// 1rem/0.9rem boxes make the default pill ≈20px tall, matching web's h-5 and
// PortalChip's documented hit-slop math (Hearth PC3).
const pillTextVariants = cva('text-[0.7rem] font-medium leading-[1rem]', {
  variants: {
    variant: {
      default: 'text-secondary-foreground',
      outline: 'text-foreground',
      primary: 'text-primary',
      muted: 'text-muted-foreground',
      destructive: 'text-destructive',
    },
    size: { default: '', sm: 'text-[0.65rem] leading-[0.9rem]' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export interface PillProps extends ViewProps, VariantProps<typeof pillVariants> {
  children?: React.ReactNode;
  textClassName?: TextProps['className'];
}

function Pill({ className, textClassName, variant = 'default', size = 'default', children, ...props }: PillProps) {
  return (
    <View className={cn(pillVariants({ variant, size }), className)} {...props}>
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text className={cn(pillTextVariants({ variant, size }), textClassName)} style={pillTextStyle}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

export { Pill, pillVariants, pillTextVariants, pillTextStyle };
