import { describe, expect, it } from 'vitest';
import { ALL_MODULE_IDS, type ModuleId } from './modules';
import { ALL_MODULE_FEATURE_IDS, MODULE_FEATURES, isFeatureEnabled } from './module-features';

// Every cross-module feature, every module: switching a module off disables
// exactly the features that list it and leaves every other feature on. New
// entries in MODULE_FEATURES are covered without touching this file.
describe('module features', () => {
  const allOn = new Set<string>(ALL_MODULE_IDS);

  it('every feature names at least one real module', () => {
    for (const id of ALL_MODULE_FEATURE_IDS) {
      expect(MODULE_FEATURES[id].modules.length, id).toBeGreaterThan(0);
      for (const m of MODULE_FEATURES[id].modules) expect(ALL_MODULE_IDS, id).toContain(m);
    }
  });

  it('every feature is on when every module is on', () => {
    for (const id of ALL_MODULE_FEATURE_IDS) expect(isFeatureEnabled(id, allOn), id).toBe(true);
  });

  it.each(ALL_MODULE_IDS)('turning %s off disables exactly the features that need it', (off: ModuleId) => {
    const on = new Set(ALL_MODULE_IDS.filter((m) => m !== off));
    for (const id of ALL_MODULE_FEATURE_IDS) {
      const needsIt = (MODULE_FEATURES[id].modules as readonly string[]).includes(off);
      expect([id, isFeatureEnabled(id, on)]).toEqual([id, !needsIt]);
    }
  });

  it('every feature is off when every module is off', () => {
    for (const id of ALL_MODULE_FEATURE_IDS) expect(isFeatureEnabled(id, new Set()), id).toBe(false);
  });

  it("a new household's defaults keep the base modules' features and drop the rest", () => {
    const base = new Set(['household', 'calendar', 'checklists', 'documents']);
    expect(isFeatureEnabled('calendar.tasks', base)).toBe(true);
    expect(isFeatureEnabled('tasks.checklists', base)).toBe(true);
    expect(isFeatureEnabled('calendar.viewings', base)).toBe(false);
    expect(isFeatureEnabled('documents.costs', base)).toBe(false);
  });
});
