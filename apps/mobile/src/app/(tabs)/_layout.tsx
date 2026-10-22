import * as React from 'react';
import { Tabs } from 'expo-router';
import { Easing, useWindowDimensions } from 'react-native';
import { MOTION_DURATIONS_MS, TAB_SHIFT_FRACTION, getSectionByPath } from '@homeup/core';
import { SectionProvider, TabGround, useStillMotion } from '@homeup/ui';
import { TabFreeze } from '@/components/nav/tab-freeze';
import { TabWarmup } from '@/components/nav/tab-warmup';
import { useTabBarSections } from '@/components/nav/use-tab-bar-sections';
import { tabScreenOrder } from '@/lib/tab-routes';

const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);
// The bar is PrimaryTabBar, rendered by the root layout.
const noTabBar = () => null;
// Each section root names its own section (its tiles, and the glow it
// borrows), whichever tab is on screen, and freezes once it has slid away.
const sceneLayout = ({
  route,
  navigation,
  children,
}: {
  route: { name: string };
  navigation: React.ComponentProps<typeof TabFreeze>['navigation'];
  children: React.ReactElement;
}) => (
  <SectionProvider sectionId={getSectionByPath(`/${route.name}`).id}>
    <TabFreeze navigation={navigation}>{children}</TabFreeze>
  </SectionProvider>
);

export default function TabsLayout() {
  const { pathname, currentSection, orderedSections, visibleSections } = useTabBarSections();

  // Hearth §8.1 Shift: screens are ranked in the tab bar's order (hidden
  // sections keep their place, so the rank doesn't move as you visit one),
  // and the navigator's progress runs -1/1 by that rank. A tab further
  // along the bar slides in from the right while the old page drifts out to
  // the left, in step with the bar's pebble; going back mirrors it.
  const orderKey = tabScreenOrder(orderedSections).join(',');
  const screens = React.useMemo(() => (orderKey ? orderKey.split(',') : []), [orderKey]);

  // The ground (fill, texture and the section glow) sits behind every
  // section root, so the glow holds still and blends into the next
  // section's hue while the pages shift over it (Hearth §13.1).
  return (
    <TabGround sectionId={currentSection.id}>
      <TabsNavigator screens={screens} />
      <TabWarmup pathname={pathname} visibleSections={visibleSections} />
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
  const shift = Math.round(width * TAB_SHIFT_FRACTION);

  const screenOptions = React.useMemo<React.ComponentProps<typeof Tabs>['screenOptions']>(
    () => ({
      headerShown: false,
      lazy: true,
      // TabFreeze (sceneLayout) does this: the navigator's own freeze never
      // fires while the shift animation is on.
      freezeOnBlur: false,
      animation: reduceMotion ? 'none' : 'shift',
      // The bar's pebble (TabGlide) glides on this same spec.
      transitionSpec: {
        animation: 'timing',
        config: { duration: MOTION_DURATIONS_MS.slow, easing: SWIFT_OUT },
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
    [reduceMotion, shift]
  );

  return (
    <Tabs tabBar={noTabBar} backBehavior="history" screenOptions={screenOptions} screenLayout={sceneLayout}>
      {screens.map((name) => (
        <Tabs.Screen key={name} name={name} />
      ))}
    </Tabs>
  );
});
