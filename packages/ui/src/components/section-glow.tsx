// Hearth v2 (Pulse): the section glow. One radial wash in the section's
// identity hue (core section-hues.ts) at the top corner of the screen,
// behind the lede. Never behind body text; it is the surface's one
// decorative element (off under the flat e-paper theme: material.sectionGlow).
//
// The section comes from SectionProvider (apps/mobile's tabs layout gives
// each section root its own), so ScreenBackground paints the right glow
// without every screen passing its own id. Under the tabs the glow is
// ground, painted once behind every section root by TabGround: it stays put
// on a tab switch and blends into the next section's hue on the page
// shift's timing (Hearth §13.1), drifting along the top in the bar's order
// ("Glow drift"). The gradient itself is static SVG; only the views holding
// it move and fade (animated SVG props broke on Android, §8).
import * as React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import {
  GLOW_AURA,
  GLOW_DRIFT_REST,
  NAV_EASE_POINTS,
  SECTION_GLOW_OPACITY,
  glowBlendAt,
  glowBlendSettle,
  glowBlendTo,
  glowLayerAlpha,
  sectionHueSwatch,
  useNavShiftMs,
  type GlowBlendState,
} from '@homeup/core';
import { useThemeMaterial, useStillMotion } from '../theme/theme-provider';
import { BackgroundTexture } from './background-texture';

const SectionContext = React.createContext<string | null>(null);

/** Names the app section the subtree belongs to (a sections.ts id), for its glow and tiles. */
export function SectionProvider({ sectionId, children }: { sectionId: string | null; children: React.ReactNode }) {
  return <SectionContext.Provider value={sectionId}>{children}</SectionContext.Provider>;
}

/** The section the nearest SectionProvider names, or null outside one. */
export function useSectionId(): string | null {
  return React.useContext(SectionContext);
}

/** Height of the glow band, in px. Tall enough to sit behind a Hero lede. */
const GLOW_HEIGHT = 420;

export interface SectionGlowProps {
  /** A sections.ts id. Defaults to the nearest SectionProvider's. */
  sectionId?: string | null;
}

export function SectionGlow({ sectionId }: SectionGlowProps) {
  const contextSection = useSectionId();
  const material = useThemeMaterial();
  const section = sectionId ?? contextSection;
  if (!section || !material.sectionGlow) return null;
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      className="absolute left-0 right-0 top-0 z-0"
      style={{ height: GLOW_HEIGHT }}
    >
      <GlowGradient section={section} />
    </View>
  );
}

// Which parts of the glow a gradient draws: all of it (a still glow), only
// the theme's fixed aura, or only the section's wash centred in a band twice
// the screen's width (a drifting glow: moving the band carries the centre
// anywhere across the screen, and the halved radius keeps the shape).
type GlowParts = 'all' | 'aura' | 'drift';

/** The glow draws at 1/GLOW_RASTER_SCALE of its size, then scales up. */
const GLOW_RASTER_SCALE = 4;
const glowRasterStyle = {
  transform: [{ scale: GLOW_RASTER_SCALE }],
  transformOrigin: 'top left',
} as const;

function GlowGradient({ section, parts = 'all' }: { section: string; parts?: GlowParts }) {
  const material = useThemeMaterial();
  const { glow } = sectionHueSwatch(section, material.scheme);
  const opacity = SECTION_GLOW_OPACITY[material.scheme];
  const aura = parts === 'drift' ? [] : (GLOW_AURA[material.scheme] ?? []);
  const wash = parts !== 'aura';
  const cx = parts === 'drift' ? '50%' : '88%';
  const rx = parts === 'drift' ? '42.5%' : '85%';
  const gradientId = `section-glow-${section}-${parts}`;
  // react-native-svg rasterises on the UI thread's CPU. At full size the
  // drift band (twice the screen wide) took 20-35ms to draw each time a
  // switch mounted a new layer, dropping 4-5 frames as the slide began. A
  // soft radial wash looks the same drawn small and scaled up.
  return (
    <Svg width={`${100 / GLOW_RASTER_SCALE}%`} height={`${100 / GLOW_RASTER_SCALE}%`} style={glowRasterStyle}>
      <Defs>
        {/* A theme's fixed aura (Sorbet) sits under the section's own wash. */}
        {aura.map((layer, i) => (
          <RadialGradient
            key={i}
            id={`${gradientId}-aura-${i}`}
            cx={`${layer.cx * 100}%`}
            cy={`${layer.cy * 100}%`}
            rx={`${layer.rx * 100}%`}
            ry={`${layer.ry * 100}%`}
            fx={`${layer.cx * 100}%`}
            fy={`${layer.cy * 100}%`}
          >
            <Stop offset="0" stopColor={layer.color} stopOpacity={opacity} />
            <Stop offset={layer.fade} stopColor={layer.color} stopOpacity={0} />
          </RadialGradient>
        ))}
        {/* Centred past the top edge so the wash fades in from the edge
            instead of drawing a visible disc. */}
        <RadialGradient id={gradientId} cx={cx} cy="-8%" rx={rx} ry="78%" fx={cx} fy="-8%">
          <Stop offset="0" stopColor={glow} stopOpacity={opacity} />
          <Stop offset="0.55" stopColor={glow} stopOpacity={opacity * 0.35} />
          <Stop offset="1" stopColor={glow} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {aura.map((_, i) => (
        <Rect key={i} width="100%" height="100%" fill={`url(#${gradientId}-aura-${i})`} />
      ))}
      {wash && <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />}
    </Svg>
  );
}

// The glow moves on the page shift's clock (the device's navigation speed,
// on Hearth's Glide curve), in step with the page and the tab bar's pebble.
const NAV_EASE = Easing.bezier(...NAV_EASE_POINTS);

interface Ground {
  /** A section root's own glow choice: a section to borrow, null for none, undefined to hand it back. */
  borrow(owner: string, section: string | null | undefined): void;
}

const GroundContext = React.createContext<Ground | null>(null);

/** The TabGround painting the ground behind this screen, or null outside one. */
export function useTabGround(): Ground | null {
  return React.useContext(GroundContext);
}

export interface TabGroundProps {
  /** The section on screen (a sections.ts id). */
  sectionId: string;
  /** Where the glow's centre sits across the screen, 0 to 1 (core glowDriftX). Defaults to the top right corner. */
  driftX?: number;
  children: React.ReactNode;
}

/**
 * The ground behind every section root under the tabs: the page fill, the
 * body texture and one glow in the section on screen's hue (or the hue its
 * root borrowed, like Home's open lens). Section roots inside paint no
 * ground of their own (ScreenBackground), so the glow holds still while the
 * pages shift over it, drifting along the top into the next section's place
 * and hue as they do.
 */
export function TabGround({ sectionId, driftX = GLOW_DRIFT_REST, children }: TabGroundProps) {
  const material = useThemeMaterial();
  const [borrowed, setBorrowed] = React.useState<Readonly<Record<string, string | null>>>({});
  const ground = React.useMemo<Ground>(
    () => ({
      borrow(owner, section) {
        setBorrowed((prev) => {
          if (section === undefined) {
            if (!(owner in prev)) return prev;
            const next = { ...prev };
            delete next[owner];
            return next;
          }
          return prev[owner] === section ? prev : { ...prev, [owner]: section };
        });
      },
    }),
    []
  );
  const glow = sectionId in borrowed ? borrowed[sectionId] : sectionId;
  return (
    <View className="flex-1 bg-background">
      <BackgroundTexture kind={material.textureKind} opacity={material.textureOpacity} color={material.textureColor} />
      {material.sectionGlow && <GlowBlend section={glow} driftX={driftX} />}
      <GroundContext.Provider value={ground}>{children}</GroundContext.Provider>
    </View>
  );
}

/**
 * One glow per section seen, in a band that drifts to `driftX`, over the
 * theme's still aura. A switch blends the section layers on the page
 * shift's clock with weights that always add up to one glow (core
 * glow-blend.ts), so the colour turns from one hue to the next at the same
 * strength, never brighter or washed out midway; a quick second switch
 * picks up from wherever the glow is, and layers that faded to nothing
 * leave once the blend lands.
 */
function GlowBlend({ section, driftX }: { section: string | null; driftX: number }) {
  const duration = useNavShiftMs();
  const reduceMotion = useStillMotion();
  const material = useThemeMaterial();
  const strength = SECTION_GLOW_OPACITY[material.scheme];
  const [blend, setBlend] = React.useState<GlowBlendState>(() => glowBlendAt(section));
  const blendRef = React.useRef(blend);
  const shared = useSharedValue<GlowBlendState>(blend);
  // Eased progress of the current blend, 0 to 1.
  const progress = useSharedValue(1);

  const settle = React.useCallback(() => {
    const next = glowBlendSettle(blendRef.current);
    blendRef.current = next;
    shared.value = next;
    setBlend(next);
  }, [shared]);

  React.useLayoutEffect(() => {
    const now = blendRef.current;
    if (now.layers[now.layers.length - 1] === section) return;
    if (reduceMotion) {
      const still = glowBlendAt(section);
      blendRef.current = still;
      shared.value = still;
      progress.value = 1;
      setBlend(still);
      return;
    }
    const next = glowBlendTo(now, section, progress.value);
    blendRef.current = next;
    shared.value = next;
    progress.value = 0;
    progress.value = withTiming(1, { duration, easing: NAV_EASE }, (finished) => {
      if (finished) runOnJS(settle)();
    });
    setBlend(next);
    // Only a new section starts a blend; a speed change waits for the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const { width } = useWindowDimensions();
  const x = useSharedValue(driftX);
  React.useEffect(() => {
    x.value = reduceMotion ? driftX : withTiming(driftX, { duration, easing: NAV_EASE });
    // Only a new place starts a drift; a speed change waits for the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driftX, reduceMotion, x]);
  // The band starts half a screen to the left, so its centre (the wash's)
  // sits mid-screen with no shift; the shift carries it to driftX.
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: (x.value - 0.5) * width }] }));

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      className="absolute left-0 right-0 top-0 z-0 overflow-hidden"
      style={{ height: GLOW_HEIGHT }}
    >
      {section && <GlowGradient section={section} parts="aura" />}
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: -width / 2, width: width * 2 }, band]}>
        {blend.layers.map((layer, i) => (
          <GlowLayer
            key={layer ?? 'none'}
            section={layer}
            index={i}
            blend={shared}
            progress={progress}
            strength={strength}
          />
        ))}
      </Animated.View>
    </View>
  );
}

interface GlowLayerProps {
  section: string | null;
  /** This layer's place in the blend, bottom to top. */
  index: number;
  blend: SharedValue<GlowBlendState>;
  progress: SharedValue<number>;
  /** The glow's peak opacity for the theme (SECTION_GLOW_OPACITY). */
  strength: number;
}

function GlowLayer({ section, index, blend, progress, strength }: GlowLayerProps) {
  const style = useAnimatedStyle(
    () => ({ opacity: glowLayerAlpha(blend.value, index, progress.value, strength) }),
    [index, strength]
  );
  if (!section) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <GlowGradient section={section} parts="drift" />
    </Animated.View>
  );
}
