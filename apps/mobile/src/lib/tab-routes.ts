// Screen-swap latency: the section roots live in the src/app/(tabs) group, a
// Tabs navigator that keeps each visited screen mounted (frozen while
// hidden), so going back to a section is a crossfade, not a fresh mount.
// Before this, every section was a root Stack screen and every tab tap
// mounted a brand new copy of the destination while leaving the previous
// ones alive underneath (expo-router's `navigate` only reuses a route when
// it is already the top one).
//
// The catch is the root Stack sits above the group: detail screens
// (checklists/[id], recipes/new, settings...) are pushed over it. A plain
// push/navigate to a section from one of those would stack a second copy of
// the whole tabs group, so `openRoute` pops back to the existing one instead.
import * as React from 'react';
import { usePathname, useRouter, type Href } from 'expo-router';
import type { Section } from '@homeup/core';

// Mirrors the route files under src/app/(tabs). Guarded by
// tab-routes.test.ts so the two can't drift.
export const TAB_ROUTES = [
  '/home',
  '/calendar',
  '/setup',
  '/tasks',
  '/costs',
  '/homesearch',
  '/groceries',
  '/checklists',
  '/recipes',
  '/documents',
  '/appointments',
  '/checklist',
] as const;

export function isTabRoute(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  return (TAB_ROUTES as readonly string[]).includes(path);
}

/**
 * The (tabs) group's screen names in tab bar order: each section's own tab
 * routes (its root, then any nav item that is also a tab, like Home
 * Search's Appointments), section by section. The navigator ranks its
 * screens in this order, and the page slide on a tab switch follows that
 * rank, so the page travels the same way the bar's highlight does. Tab
 * routes of sections not passed (a switched-off module) rank after these.
 */
export function tabScreenOrder(sections: readonly Section[]): string[] {
  const names: string[] = [];
  for (const section of sections) {
    for (const href of [section.basePath, ...section.navItems.map((item) => item.href)]) {
      const name = href.slice(1);
      if (isTabRoute(href) && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** How to get from `pathname` to `href` without stacking a duplicate screen. */
export function routeMethod(pathname: string, href: string): 'navigate' | 'dismissTo' | 'push' {
  if (!isTabRoute(href)) return 'push';
  // Already inside the tabs group: switch tabs in place.
  if (isTabRoute(pathname)) return 'navigate';
  // On a screen stacked over the tabs group: pop back down to it and switch
  // there. With no tabs group below (a cold deep link straight into a detail
  // screen), dismissTo replaces the current screen with it instead.
  return 'dismissTo';
}

/**
 * Opens a route the way the tab bar does: section roots reuse their live
 * screen, everything else is pushed.
 */
export function useOpenRoute(): (href: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return React.useCallback(
    (href: string) => {
      router[routeMethod(pathname, href)](href as Href);
    },
    [router, pathname]
  );
}
