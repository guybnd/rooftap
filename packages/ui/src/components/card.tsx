// HOUP-68: native port of apps/web/src/components/ui/card.tsx. `:has()`-based
// sibling logic (footer padding when one exists, first/last-image rounding)
// has no RN equivalent — each slot now owns its own spacing directly instead
// (H4: still exactly one border level for the whole card).
//
// HOUP-132: the resting box-shadow is now the theme's `--card-shadow`
// (useThemeMaterial()), not a flat `shadow-sm` — themes "own... shadow"
// (Hearth §10) the same way they own hue/radius/texture. A `"none"` shadow
// composes fine as an RN boxShadow value (an explicit no-shadow, not a style
// prop that needs omitting).
import * as React from 'react';
import { Text, View, type TextProps, type ViewProps } from 'react-native';
import { cn } from '../lib/cn';
import { useThemeMaterial } from '../theme/theme-provider';

export interface CardProps extends ViewProps {
  size?: 'default' | 'sm';
}

function Card({ className, size = 'default', style, ...props }: CardProps) {
  const material = useThemeMaterial();
  return (
    <View
      className={cn(
        'flex flex-col gap-4 overflow-hidden rounded-xl border border-border/60 bg-card py-4',
        size === 'sm' && 'gap-3 py-3',
        className
      )}
      style={[{ boxShadow: material.cardShadow }, style]}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ViewProps) {
  return <View className={cn('flex flex-col gap-1 px-4', className)} {...props} />;
}

function CardTitle({ className, ...props }: TextProps) {
  return <Text className={cn('font-heading text-title font-medium text-foreground', className)} {...props} />;
}

function CardDescription({ className, ...props }: TextProps) {
  return <Text className={cn('text-body text-muted-foreground', className)} {...props} />;
}

function CardAction({ className, ...props }: ViewProps) {
  return <View className={cn('absolute right-4 top-4', className)} {...props} />;
}

function CardContent({ className, ...props }: ViewProps) {
  return <View className={cn('px-4', className)} {...props} />;
}

function CardFooter({ className, ...props }: ViewProps) {
  return (
    <View
      className={cn('flex-row items-center border-t border-border/60 bg-muted/50 p-4', className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
