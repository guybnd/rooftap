// Hearth v2 (H2, line-item anatomy): the leading tile. A rounded square in a
// section's identity hue (core section-hues.ts) holding that section's glyph:
// the one place, with the glow, a section hue may appear. Feed rows, Spaces
// and item sheets lead with it so a mixed list reads by section at a glance.
import * as React from 'react';
import { View, type ViewProps } from 'react-native';
import { hueSwatch, sectionHue, type SectionHue } from '@homeup/core';
import { cn } from '../lib/cn';
import { useThemeMaterial } from '../theme/theme-provider';
import { useSectionId } from './section-glow';

export type LeadingTileIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export type LeadingTileSize = 'sm' | 'md' | 'lg' | 'xl';

// lg is the feed row's 42px tile; xl heads an item sheet.
const SIZES: Record<LeadingTileSize, { box: number; radius: number; icon: number }> = {
  sm: { box: 28, radius: 9, icon: 15 },
  md: { box: 36, radius: 11, icon: 18 },
  lg: { box: 42, radius: 13, icon: 20 },
  xl: { box: 56, radius: 17, icon: 26 },
};

export interface LeadingTileProps extends ViewProps {
  /** A sections.ts id. Defaults to the nearest SectionProvider's. */
  sectionId?: string;
  /** A hue to wear instead of a section's (Settings menu rows). Wins over sectionId. */
  hue?: SectionHue;
  Icon: LeadingTileIcon;
  size?: LeadingTileSize;
}

export function LeadingTile({ sectionId, hue, Icon, size = 'lg', className, style, ...props }: LeadingTileProps) {
  const contextSection = useSectionId();
  const material = useThemeMaterial();
  const swatch = hueSwatch(hue ?? sectionHue(sectionId ?? contextSection ?? 'home'), material.scheme);
  const dims = SIZES[size];
  return (
    <View
      className={cn('shrink-0 items-center justify-center', className)}
      style={[{ width: dims.box, height: dims.box, borderRadius: dims.radius, backgroundColor: swatch.tile }, style]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      {...props}
    >
      <Icon size={dims.icon} color={swatch.glyph} strokeWidth={2.1} />
    </View>
  );
}
