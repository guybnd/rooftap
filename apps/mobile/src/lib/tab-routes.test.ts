import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ useNavigationContainerRef: vi.fn(), useRouter: vi.fn() }));

import { getEnabledSections, orderSections } from '@homeup/core';
import { TAB_ROUTES, isTabRoute, routeMethod, routeNamePath, tabScreenOrder } from './tab-routes';

const tabsDir = fileURLToPath(new URL('../app/(tabs)', import.meta.url));

// '(tabs)/home/index.tsx' -> '/home', '(tabs)/checklist.tsx' -> '/checklist'
function routesInTabsGroup(): string[] {
  return readdirSync(tabsDir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('_'))
    .map((entry) => `/${entry.name.replace(/\.tsx$/, '')}`)
    .sort();
}

describe('TAB_ROUTES', () => {
  it('matches the route files in src/app/(tabs)', () => {
    expect([...TAB_ROUTES].sort()).toEqual(routesInTabsGroup());
  });

  it('covers every section root the tab bar can open', () => {
    for (const section of getEnabledSections()) {
      expect(isTabRoute(section.basePath)).toBe(true);
    }
  });
});

describe('routeMethod', () => {
  it('switches tabs in place between section roots', () => {
    expect(routeMethod('/home', '/tasks')).toBe('navigate');
    expect(routeMethod('/tasks', '/groceries?add=1')).toBe('navigate');
  });

  it('pops back to the tabs group from a screen stacked over it', () => {
    expect(routeMethod('/checklists/abc', '/checklists')).toBe('dismissTo');
    expect(routeMethod('/settings', '/tasks?focus=t1')).toBe('dismissTo');
  });

  it('pushes anything that is not a section root', () => {
    expect(routeMethod('/homesearch', '/apartment/new')).toBe('push');
    expect(routeMethod('/groceries', '/groceries/shelf-life')).toBe('push');
    expect(routeMethod('/home', '/settings')).toBe('push');
  });
});

describe('routeNamePath', () => {
  it('turns a focused screen name into the path routeMethod reads', () => {
    expect(routeNamePath('home/index')).toBe('/home');
    expect(routeNamePath('checklist')).toBe('/checklist');
    expect(routeNamePath('checklists/[id]')).toBe('/checklists/[id]');
    expect(routeNamePath('settings/index')).toBe('/settings');
    expect(routeNamePath('index')).toBe('/');
    expect(routeNamePath(undefined)).toBe('');
  });

  it('agrees with the pathname on where a tab switch happens', () => {
    expect(routeMethod(routeNamePath('home/index'), '/tasks')).toBe('navigate');
    expect(routeMethod(routeNamePath('checklists/[id]'), '/checklists')).toBe('dismissTo');
  });
});

describe('tabScreenOrder', () => {
  it('ranks the tab screens in the bar order, a section\'s extra tab routes right after its root', () => {
    const sections = orderSections(getEnabledSections(), ['household', 'home', 'search']);
    const order = tabScreenOrder(sections);
    expect(order.slice(0, 2)).toEqual(['tasks', 'home']);
    const search = order.indexOf('homesearch');
    expect(order.slice(search, search + 3)).toEqual(['homesearch', 'appointments', 'checklist']);
  });

  it('names only real tab screens, each once', () => {
    const order = tabScreenOrder(getEnabledSections());
    expect(new Set(order).size).toBe(order.length);
    for (const name of order) expect(isTabRoute(`/${name}`)).toBe(true);
  });
});
