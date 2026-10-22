// Mounts the tab bar's sections in the background once the app has
// settled, one at a time, so the first tap on each is a switch to a screen
// that already exists instead of building it inside the tap. Each warmed
// screen renders, loads, then freezes (TabFreeze) until it is visited.
//
// Only the bar's own tabs: sections behind More stay lazy. A preload
// changes the navigator's state, and a navigator re-render mid-slide
// restarts the slide, so a step never runs within a slide of a tab switch.
import * as React from 'react';
import { InteractionManager } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { MOTION_DURATIONS_MS, splitTabBar, type Section } from '@homeup/core';

/** Wait after launch before the first warm-up, so Home paints and loads first. */
const START_DELAY_MS = 2500;
/** Gap between two warm-ups, so each screen's mount has the JS thread to itself. */
const STEP_DELAY_MS = 900;
/** Quiet time after a tab switch before a warm-up may run. */
const AFTER_NAV_MS = MOTION_DURATIONS_MS.slow + 300;

export function TabWarmup({ pathname, visibleSections }: { pathname: string; visibleSections: readonly Section[] }) {
  const router = useRouter();
  const lastNavAt = React.useRef(0);
  // Paths already warmed or visited: a visited tab is mounted already.
  const warmed = React.useRef(new Set<string>());
  React.useEffect(() => {
    lastNavAt.current = Date.now();
    warmed.current.add(pathname);
  }, [pathname]);

  const paths = splitTabBar([...visibleSections]).primary.map((s) => s.basePath);
  const queueKey = paths.join(',');

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let task: { cancel(): void } | undefined;
    const queue = queueKey.split(',').filter(Boolean);
    const step = () => {
      const sinceNav = Date.now() - lastNavAt.current;
      if (sinceNav < AFTER_NAV_MS) {
        timer = setTimeout(step, AFTER_NAV_MS - sinceNav);
        return;
      }
      const next = queue.find((p) => !warmed.current.has(p));
      if (!next) return;
      warmed.current.add(next);
      task = InteractionManager.runAfterInteractions(() => {
        router.prefetch(next as Href);
        timer = setTimeout(step, STEP_DELAY_MS);
      });
    };
    timer = setTimeout(step, START_DELAY_MS);
    return () => {
      clearTimeout(timer);
      task?.cancel();
    };
  }, [queueKey, router]);

  return null;
}
