import { describe, expect, it } from 'vitest';
import { ALL_MODULE_IDS, isFeatureEnabled, type ModuleFeatureId, type ModuleId } from '@homeup/core';
import { HERO_MODULES, availableHeroModules, isModuleShown } from './hero-modules';

// FLUX-258: the mobile registry is metadata-only (index.tsx renders the tile
// inline), so nothing else here would fail CI if `countdown` were dropped
// from HERO_MODULES — this asserts the twinned-registry half directly rather
// than shipping a toggle the sheet shows with no tile behind it.
describe('HERO_MODULES countdown entry (FLUX-258)', () => {
  it('registers countdown in the home group, off by default', () => {
    const countdown = HERO_MODULES.find((m) => m.key === 'countdown');
    expect(countdown).toBeDefined();
    expect(countdown?.group).toBe('home');
    expect(countdown?.defaultOn).toBe(false);
  });
});

// Modules (module-features.ts): a hero module showing another module's data
// is gone with that module, from the hero and from the customize sheet, even
// when the person's saved config has it on. Unrelated modules change nothing.
// Same table as web's summary-hero.test.ts.
describe('hero modules behind a module', () => {
  const ALL_KEYS = HERO_MODULES.map((m) => m.key);
  const allOnConfig = Object.fromEntries(ALL_KEYS.map((k) => [k, true]));
  const featureWith = (enabled: ReadonlySet<string>) => (id: ModuleFeatureId) => isFeatureEnabled(id, enabled);

  const goneWithout: Partial<Record<ModuleId, string[]>> = {
    household: ['whosOnHook', 'unassignedNudge', 'streak'],
    costs: ['budgetPulse', 'billsDue', 'spaceBudget', 'spaceBills'],
    groceries: ['shoppingList'],
    setup: ['setupProgress'],
    shopper: ['shopperWatch'],
  };

  it('everything on lists and shows every module', () => {
    const feature = featureWith(new Set(ALL_MODULE_IDS));
    expect(availableHeroModules(feature).map((m) => m.key)).toEqual(ALL_KEYS);
    expect(ALL_KEYS.filter((k) => isModuleShown(k, allOnConfig, feature))).toEqual(ALL_KEYS);
  });

  it.each(ALL_MODULE_IDS)('turning %s off removes only its modules, whatever the config says', (off) => {
    const feature = featureWith(new Set(ALL_MODULE_IDS.filter((m) => m !== off)));
    const expected = ALL_KEYS.filter((k) => !(goneWithout[off] ?? []).includes(k));
    expect(availableHeroModules(feature).map((m) => m.key)).toEqual(expected);
    expect(ALL_KEYS.filter((k) => isModuleShown(k, allOnConfig, feature))).toEqual(expected);
  });

  it("the person's own off toggle still hides a module whose feature is on", () => {
    const feature = featureWith(new Set(ALL_MODULE_IDS));
    expect(isModuleShown('budgetPulse', { budgetPulse: false }, feature)).toBe(false);
  });
});
