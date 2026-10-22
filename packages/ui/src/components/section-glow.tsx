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
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { GLOW_AURA, GLOW_DRIFT_REST, SECTION_GLOW_OPACITY, sectionHueSwatch, useNavShiftMs } from '@homeup/core';
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

function GlowGradient({ section, parts = 'all' }: { section: string; parts?: GlowParts }) {
  const material = useThemeMaterial();
  const { glow } = sectionHueSwatch(section, material.scheme);
  const opacity = SECTION_GLOW_OPACITY[material.scheme];
  const aura = parts === 'drift' ? [] : (GLOW_AURA[material.scheme] ?? []);
  const wash = parts !== 'aura';
  const cx = parts === 'drift' ? '50%' : '88%';
  const rx = parts === 'drift' ? '42.5%' : '85%';
  const gradientId = `section-glow-${section}-${parts}`;
  return (
    <Svg width="100%" height="100%">
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
// swift-out), in step with the page and the tab bar's pebble. The new hue
// comes up over the first half while the old one holds, then the old one
// lets go, so the wash never dims halfway through.
const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);

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
 * theme's still aura. The newest comes up over the ones before as they let
 * go; a quick second switch picks up from wherever the glow is, and a layer
 * leaves only once it has faded.
 */
function GlowBlend({ section, driftX }: { section: string | null; driftX: number }) {
  const duration = useNavShiftMs();
  const [layers, setLayers] = React.useState<(string | null)[]>([section]);
  if (layers[layers.length - 1] !== section) setLayers([...layers.filter((l) => l !== section), section]);
  React.useEffect(() => {
    if (layers.length < 2) return;
    const timer = setTimeout(() => setLayers((now) => now.slice(-1)), duration + 50);
    return () => clearTimeout(timer);
  }, [layers, duration]);
  // The glow on first paint is simply there; later ones blend in.
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
  }, []);

  const { width } = useWindowDimensions();
  const reduceMotion = useStillMotion();
  const x = useSharedValue(driftX);
  React.useEffect(() => {
    x.value = reduceMotion ? driftX : withTiming(driftX, { duration, easing: SWIFT_OUT });
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
        {layers.map((layer, i) => (
          <GlowLayer
            key={layer ?? 'none'}
            section={layer}
            shown={i === layers.length - 1}
            instant={!mounted.current}
            duration={duration}
          />
        ))}
      </Animated.View>
    </View>
  );
}

interface GlowLayerProps {
  section: string | null;
  shown: boolean;
  instant: boolean;
  /** The page shift's duration, ms. */
  duration: number;
}

function GlowLayer({ section, shown, instant, duration }: GlowLayerProps) {
  const reduceMotion = useStillMotion();
  const opacity = useSharedValue(shown && instant ? 1 : 0);
  React.useEffect(() => {
    if (reduceMotion) opacity.value = shown ? 1 : 0;
    else if (shown) opacity.value = withTiming(1, { duration: duration * 0.55, easing: SWIFT_OUT });
    else opacity.value = withDelay(duration * 0.35, withTiming(0, { duration: duration * 0.65, easing: SWIFT_OUT }));
    // Only a show or hide starts a fade; a speed change waits for the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, reduceMotion, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!section) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <GlowGradient section={section} parts="drift" />
    </Animated.View>
  );
}
