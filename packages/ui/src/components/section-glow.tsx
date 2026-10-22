// Hearth v2 (Pulse): the section glow. One radial wash in the section's
// identity hue (core section-hues.ts) at the top corner of the screen,
// behind the lede. Never behind body text; it is the surface's one
// decorative element, the job the meridian had under Axis Mundi (which
// keeps its meridian and gets no glow: material.sectionGlow).
//
// The section comes from SectionProvider (apps/mobile's tabs layout gives
// each section root its own), so ScreenBackground paints the right glow
// without every screen passing its own id. Under the tabs the glow is
// ground, painted once behind every section root by TabGround: it stays put
// on a tab switch and blends into the next section's hue on the page
// shift's timing (Hearth §13.1). The gradient itself is static SVG; only
// the views holding it fade (animated SVG props broke on Android, §8).
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { MOTION_DURATIONS_MS, SECTION_GLOW_OPACITY, sectionHueSwatch } from '@homeup/core';
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

function GlowGradient({ section }: { section: string }) {
  const material = useThemeMaterial();
  const { glow } = sectionHueSwatch(section, material.scheme);
  const opacity = SECTION_GLOW_OPACITY[material.scheme];
  const gradientId = `section-glow-${section}`;
  return (
    <Svg width="100%" height="100%">
      <Defs>
        {/* Centred past the top-right corner so the wash fades in from the
            edge instead of drawing a visible disc. */}
        <RadialGradient id={gradientId} cx="88%" cy="-8%" rx="85%" ry="78%" fx="88%" fy="-8%">
          <Stop offset="0" stopColor={glow} stopOpacity={opacity} />
          <Stop offset="0.55" stopColor={glow} stopOpacity={opacity * 0.35} />
          <Stop offset="1" stopColor={glow} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

// The page shift's spec ((tabs) navigator transitionSpec, TabGlide): Hearth
// `slow`, swift-out.
const BLEND = { duration: MOTION_DURATIONS_MS.slow, easing: Easing.bezier(0.16, 1, 0.3, 1) };

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
  children: React.ReactNode;
}

/**
 * The ground behind every section root under the tabs: the page fill, the
 * body texture and one glow in the section on screen's hue (or the hue its
 * root borrowed, like Home's open lens). Section roots inside paint no
 * ground of their own (ScreenBackground), so the glow holds still while the
 * pages shift over it and blends into the next section's hue as they do.
 */
export function TabGround({ sectionId, children }: TabGroundProps) {
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
      {material.sectionGlow && <GlowBlend section={glow} />}
      <GroundContext.Provider value={ground}>{children}</GroundContext.Provider>
    </View>
  );
}

/** One glow per section seen, the newest fading in over the one before as it fades out. */
function GlowBlend({ section }: { section: string | null }) {
  const [layers, setLayers] = React.useState<(string | null)[]>([section]);
  const current = layers[layers.length - 1];
  if (current !== section) setLayers([current, section]);
  // The glow on first paint is simply there; later ones blend in.
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
  }, []);
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      className="absolute left-0 right-0 top-0 z-0"
      style={{ height: GLOW_HEIGHT }}
    >
      {layers.map((layer, i) => (
        <GlowLayer key={layer ?? 'none'} section={layer} shown={i === layers.length - 1} instant={!mounted.current} />
      ))}
    </View>
  );
}

function GlowLayer({ section, shown, instant }: { section: string | null; shown: boolean; instant: boolean }) {
  const reduceMotion = useStillMotion();
  const opacity = useSharedValue(shown && instant ? 1 : 0);
  React.useEffect(() => {
    opacity.value = reduceMotion ? (shown ? 1 : 0) : withTiming(shown ? 1 : 0, BLEND);
  }, [shown, reduceMotion, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!section) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <GlowGradient section={section} />
    </Animated.View>
  );
}
