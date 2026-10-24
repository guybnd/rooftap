import { describe, expect, it } from 'vitest';
import { MODULES } from './modules';
import { sections } from './sections';
import { MODULE_SETTINGS, hasModuleSettings, moduleSettingsPanels, moduleSettingsTitle } from './module-settings';

describe('module settings', () => {
  it('lists settings only for modules with a section', () => {
    const ids = new Set(MODULES.map((m) => m.id));
    for (const id of Object.keys(MODULE_SETTINGS)) {
      expect(ids.has(id as never), id).toBe(true);
      expect(sections.some((s) => s.id === id), `${id} has a screen to open them from`).toBe(true);
    }
  });

  it('names each panel once', () => {
    const all = Object.values(MODULE_SETTINGS).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('shows a panel owned by another module only while that module is on', () => {
    expect(moduleSettingsPanels('calendar', new Set(['calendar']))).toEqual([]);
    expect(moduleSettingsPanels('calendar', new Set(['calendar', 'google-calendar']))).toEqual(['google-calendar']);
    expect(hasModuleSettings('calendar', new Set(['calendar']))).toBe(false);
  });

  it('keeps the Costs panels in order', () => {
    expect(moduleSettingsPanels('costs', new Set(['costs']))).toEqual(['costs-goal', 'costs-recent', 'costs-subscriptions', 'costs-summaries']);
    expect(moduleSettingsPanels('recipes', new Set(['recipes']))).toEqual([]);
  });

  it('titles the row and the sheet', () => {
    expect(moduleSettingsTitle('Costs')).toBe('Costs settings');
  });
});
