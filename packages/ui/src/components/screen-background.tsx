// HOUP-163: the opaque "Page" surface (Hearth H4) every Expo Router screen
// root renders — react-native-screens needs each Stack screen opaque at its
// own root so push/pop transitions don't flash stale content through one
// another, which is exactly what made HOUP-132's BackgroundTexture (mounted
// once in ThemeProvider, behind the whole <Stack>) invisible: every screen's
// own opaque bg-background painted over it. This wraps that same opaque
// bg-background in a container that also re-mounts BackgroundTexture inside
// itself, so the texture is visible again in the gaps around cards on every
// screen, not just conceptually behind the Stack.
//
// Hearth v2: it also paints the section glow (section-glow.tsx) for the
// section the nearest SectionProvider names, or the one passed here.
//
// Under the tabs, TabGround already paints all of that behind every section
// root (so the glow can hold still and blend while pages shift over it):
// there this is a clear container, and a glow passed here is handed to the
// ground for whenever this root's section is on screen.
import * as React from 'react';
import { View, type ViewProps } from 'react-native';
import { cn } from '../lib/cn';
import { useThemeMaterial } from '../theme/theme-provider';
import { BackgroundTexture } from './background-texture';
import { SectionGlow, useSectionId, useTabGround } from './section-glow';

export interface ScreenBackgroundProps extends ViewProps {
  /** The section whose glow to paint (a sections.ts id). Defaults to the nearest SectionProvider's; pass null for none. */
  sectionId?: string | null;
}

export function ScreenBackground({ className, children, sectionId, ...props }: ScreenBackgroundProps) {
  const material = useThemeMaterial();
  const ground = useTabGround();
  const owner = useSectionId();
  React.useEffect(() => {
    if (!ground || !owner || sectionId === undefined) return;
    ground.borrow(owner, sectionId);
    return () => ground.borrow(owner, undefined);
  }, [ground, owner, sectionId]);
  if (ground) {
    return (
      <View className={cn('flex-1', className)} {...props}>
        {children}
      </View>
    );
  }
  return (
    <View className={cn('flex-1 bg-background', className)} {...props}>
      <BackgroundTexture kind={material.textureKind} opacity={material.textureOpacity} color={material.textureColor} />
      {sectionId !== null && <SectionGlow sectionId={sectionId} />}
      {children}
    </View>
  );
}
