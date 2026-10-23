import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getModuleIdForPath } from '@homeup/core';

// Modules (.docs/modules.md): the root layout's route guard
// (use-module-route-guard.ts) sends anyone on a switched-off module's route
// to /home, using getModuleIdForPath. Every top-level route must be
// classified here, so a new screen can't ship without someone deciding which
// module it belongs to (or that it's platform and stays reachable with every
// module off). Lives in src/lib, not src/app: Expo Router bundles any file
// under src/app (see scripts/check-router-dir.mjs).
const EXPECTED: Record<string, string | null> = {
  // Modules
  tasks: 'household',
  calendar: 'calendar',
  checklists: 'checklists',
  documents: 'documents',
  groceries: 'groceries',
  recipes: 'recipes',
  shopper: 'shopper',
  rewards: 'rewards',
  occasions: 'occasions',
  assistant: 'assistant',
  costs: 'costs',
  setup: 'setup',
  homesearch: 'search',
  apartment: 'search',
  appointments: 'search',
  checklist: 'search',
  // Platform
  home: null,
  settings: null,
  login: null,
  callback: null,
  'server-picker': null,
};

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url));

function topLevelRoutes(dir: string): string[] {
  const routes = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (name.startsWith('_') || name.startsWith('+')) continue;
    // Groups like (tabs) don't add a path segment.
    if (entry.isDirectory() && name.startsWith('(')) {
      for (const r of topLevelRoutes(join(dir, name))) routes.add(r);
    } else if (entry.isDirectory()) {
      routes.add(name);
    } else if (/\.tsx?$/.test(name) && !/^index\./.test(name)) {
      routes.add(name.replace(/\.tsx?$/, ''));
    }
  }
  return [...routes];
}

describe('module ownership of mobile routes', () => {
  const routes = topLevelRoutes(APP_DIR);

  it('classifies every top-level route', () => {
    const unclassified = routes.filter((r) => !(r in EXPECTED));
    expect(unclassified, 'add these to EXPECTED with their module, or null for platform').toEqual([]);
  });

  it.each(routes.filter((r) => r in EXPECTED))('/%s belongs to the expected module', (route) => {
    expect(getModuleIdForPath(`/${route}`)).toBe(EXPECTED[route]);
    expect(getModuleIdForPath(`/${route}/some-id`)).toBe(EXPECTED[route]);
  });
});
