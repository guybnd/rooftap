import * as React from 'react';
import { Tabs } from 'expo-router';
import { Easing, useWindowDimensions } from 'react-native';
import { TAB_SHIFT_FRACTION, getSectionByPath, glowDriftX, useNavShiftMs } from '@homeup/core';
import { SectionProvider, TabGround, useStillMotion } from '@homeup/ui';
import { DeferredScene } from '@/components/nav/deferred-scene';
import { useTabBarSections } from '@/components/nav/use-tab-bar-sections';
import { perfMark } from '@/lib/perf-log';
import { tabScreenOrder } from '@/lib/tab-routes';

const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);
// The bar is PrimaryTabBar, rendered by the root layout.
const noTabBar = () => null;
type SceneProps = {
  route: { key: string; name: string; params?: Readonly<Record<string, unknown>> };
  navigation: React.ComponentProps<typeof DeferredScene>['navigation'];
  children: React.ReactElement;
};

// Each section root names its own section (its tiles, and the glow it
// borrows), whichever tab is on screen.
//
// The navigator hands every scene a fresh element on each of its renders,
// and every tab switch renders it, so each section root re-rendered on
// every switch: the screen you came back to replayed its whole render in
// the tap's commit, ahead of the slide (a frozen screen holds the update
// until it is back). A scene only needs to render again when its route
// changes (new params, like /groceries?add=1); its own state, stores and
// contexts still reach it as they always did. A first visit mounts the
// screen once the slide lands (DeferredScene).
const Scene = React.memo(
  function Scene({ route, navigation, children }: SceneProps) {
    return (
      <SectionProvider sectionId={getSectionByPath(`/${route.name}`).id}>
        <DeferredScene navigation={navigation}>{children}</DeferredScene>
      </SectionProvider>
    );
  },
  (prev, next) => sameRoute(prev.route, next.route)
);

// A navigate hands the destination a new route object even when nothing in
// it changed, so compare what a screen can read: its key and params.
function sameRoute(a: SceneProps['route'], b: SceneProps['route']): boolean {
  if (a === b) return true;
  if (a.key !== b.key) return false;
  const pa = a.params ?? {};
  const pb = b.params ?? {};
  const keys = Object.keys(pa);
  return keys.length === Object.keys(pb).length && keys.every((k) => Object.is(pa[k], pb[k]));
}
const sceneLayout = ({
  route,
  navigation,
  children,
}: {
  route: { key: string; name: string; params?: object };
  navigation: SceneProps['navigation'];
  children: React.ReactElement;
}) => (
  <Scene route={route as SceneProps['route']} navigation={navigation}>
    {children}
  </Scene>
);

// Profiling builds only (perf-log.ts): the slide starts once the tap's commit
// is on screen, so press to start is the JS cost of the switch.
const slideMarks = ({ route }: { route: { name: string } }) => ({
  transitionStart: () => perfMark('nav:slide:start', route.name),
  transitionEnd: () => perfMark('nav:slide:end', route.name),
});

export default function TabsLayout() {
  const { currentSection, orderedSections } = useTabBarSections();

  // Hearth §8.1 Shift: screens are ranked in the tab bar's order (hidden
  // sections keep their place, so the rank doesn't move as you visit one),
  // and the navigator's progress runs -1/1 by that rank. A tab further
  // along the bar slides in from the right while the old page drifts out to
  // the left, in step with the bar's pebble; going back mirrors it.
  const orderKey = tabScreenOrder(orderedSections).join(',');
  const screens = React.useMemo(() => (orderKey ? orderKey.split(',') : []), [orderKey]);

  // The glow drifts along the top in the same order, so it travels the way
  // the page slides (Hearth §13.1 "Glow drift").
  const driftX = glowDriftX(
    orderedSections.map((s) => s.id),
    currentSection.id
  );

  // The ground (fill, texture and the section glow) sits behind every
  // section root, so the glow holds still and blends into the next
  // section's hue while the pages shift over it (Hearth §13.1).
  return (
    <TabGround sectionId={currentSection.id} driftX={driftX}>
      <TabsNavigator screens={screens} />
    </TabGround>
  );
}

// This layout re-renders on every path change (the pathname lands a commit
// after the navigator has started its slide) and on data-cache updates. The
// tab view restarts its slide whenever the navigator re-renders: the new
// page's slide starts over and the old page skips straight to gone. So the
// navigator only re-renders for its own navigation state, its screen list
// and the window.
const TabsNavigator = React.memo(function TabsNavigator({ screens }: { screens: readonly string[] }) {
  const { width } = useWindowDimensions();
  const reduceMotion = useStillMotion();
  // The device's navigation speed (Settings > Appearance), shared with the
  // pebble and the glow so all three move as one.
  const shiftMs = useNavShiftMs();
  const shift = Math.round(width * TAB_SHIFT_FRACTION);

  const screenOptions = React.useMemo<React.ComponentProps<typeof Tabs>['screenOptions']>(
    () => ({
      headerShown: false,
      lazy: true,
      freezeOnBlur: true,
      animation: reduceMotion ? 'none' : 'shift',
      // The bar's pebble (TabGlide) glides on this same spec.
      transitionSpec: {
        animation: 'timing',
        config: { duration: shiftMs, easing: SWIFT_OUT },
      },
      sceneStyleInterpolator: ({ current }) => ({
        sceneStyle: {
          opacity: current.progress.interpolate({
            inputRange: [-1, -0.6, 0, 0.6, 1],
            outputRange: [0, 0, 1, 0, 0],
          }),
          transform: [
            {
              translateX: current.progress.interpolate({
                inputRange: [-1, 0, 1],
                outputRange: [-shift, 0, shift],
              }),
            },
          ],
        },
      }),
      sceneStyle: { backgroundColor: 'transparent' },
    }),
    [reduceMotion, shift, shiftMs]
  );

  return (
    <Tabs
      tabBar={noTabBar}
      backBehavior="history"
      screenOptions={screenOptions}
      screenLayout={sceneLayout}
      screenListeners={slideMarks}
    >
      {screens.map((name) => (
        <Tabs.Screen key={name} name={name} />
      ))}
    </Tabs>
  );
});
